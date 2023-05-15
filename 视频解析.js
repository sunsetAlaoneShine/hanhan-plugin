import fetch from 'node-fetch'
import fs from 'fs'
import https from 'https'
import path from 'node:path'
if (!global.segment) {
    global.segment = (await import('oicq')).segment
}

/**
 * 可有可无的，没啥意义的功能，像极了人生。另外，这个插件没有任何技术水平，完全是体力活。
 * 超过100M的视频可能会发送失败，这似乎不是插件的问题。
 */

/**
 * 快手解析Cookie。Cookie失效会爬取失败，记得及时更换。
 * 打开快手官网，按F12，点击Console/控制台，复制下一行代码进去，然后按回车。执行完毕后您的剪切板应该就存储了快手cookie。
 * copy(document.cookie.split(";").reduce((str, cookie) => (["didv", "did"].includes(cookie.split("=")[0].trim()) ? `${str}${cookie.trim()};` : str), '').slice(0, -1));
 */
const Cookie = 'did=web_e76305cc2ec94709996662208eae31b8; didv=1682408511000'

/**
 * 抖音视频解析接口。直接用接口吧，没时间研究X-Bogus签名了。
 * 解析服务的项目地址：https://github.com/Evil0ctal/Douyin_TikTok_Download_API
 */
const baseUrl = 'https://douyin.vme50.vip'

/**
 * 视频解析
 * @param e oicq传递的事件参数e
 */
Bot.on("message", async (e) => {
    //检查消息类型,text为文本消息类型，json为小程序或者卡片消息类型。如果是图片等其他消息，则返回主线程。
    //console.log('debug', e.message)
    let msg
    e.message.forEach(element => {
        if (element.type == 'text') {
            msg = element.text
        } else if (element.type == 'json') {
            try {
                const jsonObject = JSON.parse(element.data)
                msg = jsonObject.meta.detail_1?.qqdocurl ?? jsonObject.meta.data?.feedInfo?.jumpUrl ?? jsonObject.meta.news?.jumpUrl ?? null
            } catch (err) {
                console.log('似乎解析不到需要的json对象的属性，注意json对象的属性名是否正确哦')
                return false
            }
        } else {
            return false
        }
    })
    let matchUrl = msg?.match(/(https?:\/\/[^\s]+)/)
    if (matchUrl) {
        matchUrl = matchUrl[0]
    } else {
        return false
    }
    let filePath
    const bilibilUrls = ['b23.tv', 'www.bilibili.com', 'm.bilibili.com']
    const littleWorldUrls = ['xsj.qq.com']
    const douyinUrls = ['www.douyin.com', 'v.douyin.com', 'www.tiktok.com']
    const kuaishouUrls = ['www.kuaishou.com', 'v.kuaishou.com']
    if (bilibilUrls.some(url => matchUrl.includes(url))) {
        filePath = await bilibili(e, matchUrl)
    } else if (littleWorldUrls.some(url => matchUrl.includes(url))) {
        filePath = await littleWorld(e, matchUrl)
    } else if (douyinUrls.some(url => matchUrl.includes(url))) {
        filePath = await douyin(e, matchUrl)
    } else if (kuaishouUrls.some(url => matchUrl.includes(url))) {
        filePath = await kuaishou(e, matchUrl)
    } else {
        return false
    }
    if (!filePath) {
        return false
    }
    // 停1秒再发送
    setTimeout(async () => {
        try {
            await e.reply(segment.video(filePath))
        } catch (error) {
            delFile(filePath)
            return true
        }
        // 停10秒再删除
        setTimeout(async () => {
            delFile(filePath)
            return true
        }, 10000)
    }, 1000)
})

/**
 * 快手解析
 * @param e oicq的事件传递参数e 
 * @param matchUrl 从消息中匹配到的视频url
 */
async function kuaishou(e, matchUrl) {
    console.log('[视频解析]快手视频', matchUrl)
    const d = Math.ceil(Math.random() * 255)
    const randomIp = '114.80.166.' + d
    //带上cookie防滑块验证，或许能吧。
    const options = {
        headers: {
            "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/113.0.0.0 Safari/537.36",
            'referer': matchUrl,
            'x-forwarded-for': randomIp,
            'Host': 'www.kuaishou.com',
            'Origin': 'https://www.kuaishou.com',
            'Cookie': Cookie
        }
    }
    //直接跳转会404，既然url上有视频id，那么简单拼接一下吧。
    let throwUserId
    if (matchUrl.includes('v.kuaishou.com')) {
        let againRes = (await fetch(matchUrl)).url
        let photoID = againRes.match(/\b\w{15}\b/)[0]
        matchUrl = 'https://www.kuaishou.com/short-video/' + photoID
        //不想遍历json找作者id了，也从Url中挖了个过来......
        throwUserId = againRes.match(/userId=(\w+)/)[1]
    }
    //无法从这个链接中获得作者id，不想处理了，后面直接替换为Not found
    if (matchUrl.includes('www.kuaishou.com/f/')) {
        matchUrl = (await fetch(matchUrl)).url
        //console.log(matchUrl)
    }
    let response = await fetch(matchUrl, options)
        .then(response => response.text())
    //如果你觉得爬虫没水平，不要觉得，确实没水平。
    const regex = /<script>window\.__APOLLO_STATE__=(.+?);\(function/s
    const match = regex.exec(response)
    if (!match) {
        throw new Error('在响应内容中找不到正则匹配数据，可能触发了网站的反爬虫机制')
    }
    let jsonObject
    try {
        jsonObject = JSON.parse(match[1])
        //console.log(jsonObject)
    } catch (err) {
        throw new Error('转换成json对象时发生错误，可能未获取到正确的网页数据')
    }
    const authorID = matchUrl.match(/authorId=(\w+)/)?.[1] || matchUrl.match(/userId=(\w+)/)?.[1] || throwUserId
    const photoID = matchUrl.match(/\b\w{15}\b/) //作品id
    const authorPropertyName = `VisionVideoDetailAuthor:${authorID}`
    const photoPropertyName = `VisionVideoDetailPhoto:${photoID}`
    const { photoUrl, caption, coverUrl, realLikeCount, viewCount, timestamp } = jsonObject.defaultClient[photoPropertyName]
    const name = jsonObject.defaultClient[authorPropertyName]?.name
    const pubdate = timesTamp(timestamp.toString().substring(0, 10))
    const titleStr = `标题：${caption.match(/^[^#\[\n]+/)}\n`
    const authorStr = `作者：${name ? name : 'Not found'}${' '.repeat(30 - (name ? name.toString() : 'Not found').length)}上传时间：${pubdate}\n`
    const likeStr = `喜欢：${realLikeCount}${' '.repeat(30 - realLikeCount.toString().length)}播放：${viewCount}`
    e.reply([
        segment.image(coverUrl),
        '\n',
        '快手视频\n',
        titleStr,
        authorStr,
        likeStr
    ])
    const dirPath = 'resources/videoRealUrl/kuaishou'
    const filePath = await download(photoUrl, photoID, dirPath, matchUrl)
    return filePath
}

/**
 * 哔哩哔哩视频处理
 * @param e oicq传递的事件参数e
 * @param matchUrl 从消息中匹配到的Url
 * @returns 文件下载路径
 */
async function bilibili(e, matchUrl) {
    let bvid = matchUrl.match(/BV\w{10}/)
    //兼容小程序
    if (!bvid) {
        const againRes = (await fetch(matchUrl)).url
        bvid = againRes.match(/BV\w{10}/)
    }
    const resUrl = 'https://api.bilibili.com/x/web-interface/view?bvid=' + bvid
    const res = await bilibiliRes(resUrl)
    const { pic, title, desc, owner, tname } = res.response.data
    const { like, coin, favorite, share, view, danmaku, reply } = res.response.data.stat
    const titleStr = `标题：${title}\n`
    const descStr = `简介：${desc == '-' ? '空' : desc || '空'}\n`
    const authorStr = `作者：${owner.name}${' '.repeat(32 - owner.name.toString().length)}上传时间：${res.pubdate}\n`
    const likeStr = `点赞：${like}${' '.repeat(32 - like.toString().length)}投币：${coin}\n`
    const favoriteStr = `收藏：${favorite}${' '.repeat(32 - favorite.toString().length)}分享：${share}\n`
    const viewStr = `播放：${view}${' '.repeat(32 - view.toString().length)}弹幕：${danmaku}\n`
    const replyStr = `评论：${reply}${' '.repeat(32 - reply.toString().length)}频道：${tname}`
    e.reply([
        segment.image(pic),
        '\n',
        '哔哩哔哩视频\n',
        titleStr,
        descStr,
        authorStr,
        likeStr,
        favoriteStr,
        viewStr,
        replyStr
    ])
    const dirPath = 'resources/videoRealUrl/bilibili'
    const referer = 'https://www.bilibili.com/'
    const filePath = await download(res.realUrl, bvid, dirPath, referer)
    return filePath
}

/**
 * 哔哩哔哩视频解析
 * @param resUrl 拼接后得到的哔哩哔哩API
 * @returns 对象字面量
 */
async function bilibiliRes(resUrl) {
    console.log('[哔哩哔哩视频处理]', resUrl)
    let response = await fetch(resUrl)
    if (response.status == 404) {
        throw new Error('Resource not found')
    } else {
        response = await response.json()
    }
    const pubdate = timesTamp(response.data.pubdate)
    //get API
    const aid = response.data.aid
    const cid = response.data.cid
    const newUrl = `https://api.bilibili.com/x/player/playurl?avid=${aid}&cid=${cid}&qn=16&type=mp4&platform=html5`
    let res = await fetch(newUrl)
    res = await res.json()
    const realUrl = res.data.durl[0].url
    return {
        response,
        realUrl,
        pubdate
    }
}

/**
 * 微视视频处理
 * @param {Event} e oicq传递的事件参数e
 * @param {string} matchUrl 从消息中匹配到的Url
 * @returns 文件的下载路径
 */
async function littleWorld(e, matchUrl) {
    const initialState = await littleWorldRes(matchUrl)
    const { createTime, content, poster, likeInfo, share, commentCount, musicInfo, cover } = initialState.feeds[0]
    const pubdate = timesTamp(createTime.low)
    const titleStr = `标题：${content.match(/^[^#\[\n]+/)}\n`
    const authorStr = `作者：${poster.nick}${' '.repeat(32 - poster.nick.toString().length)}上传时间：${pubdate}\n`
    const likeStr = `喜欢：${likeInfo.count}${' '.repeat(32 - likeInfo.count.toString().length)}分享：${share.sharedCount}\n`
    const shareStr = `评论：${commentCount}`

    e.reply([
        segment.image(cover.picUrl),
        '\n',
        '微视视频\n',
        titleStr,
        authorStr,
        likeStr,
        shareStr
    ])
    const realUrl = initialState.feeds[0].video.playUrl
    const videoID = initialState.feeds[0].id
    const dirPath = 'resources/videoRealUrl/littleWorld'
    const referer = 'https://xsj.qq.com/'
    const filePath = await download(realUrl, videoID, dirPath, referer)
    return filePath
}

/**
 * 微视视频解析
 * @param {string} resUrl 请求的视频网站Url
 * @returns 请求得到的json数据
 */
async function littleWorldRes(resUrl) {
    console.log('[微视视频解析]', resUrl)
    const response = await fetch(resUrl)
    if (!response.ok) {
        throw new Error(`获取数据失败，状态代码: ${response.status}`)
    }
    const textData = await response.text()
    const regex = /<script>window\.__INITIAL_STATE__=(.+?)<\/script>/s
    const match = regex.exec(textData)
    if (!match) {
        throw new Error('未能从请求的响应中获得匹配数据')
    }
    const initialState = JSON.parse(match[1])
    return initialState
}

/**
 * 抖音视频处理
 * @param e oicq传递的事件参数e
 * @param {string} matchUrl 从消息中匹配到的Url
 * @returns 文件的下载路径
 */
async function douyin(e, matchUrl) {
    let resUrl = baseUrl + '/api?url=' + matchUrl + '&minimal=false'
    let data = await douyinRes(resUrl)
    const pubdate = timesTamp(data.create_time)
    const { collect_count, comment_count, digg_count, share_count } = data.statistics
    const cover = data.cover_data.cover.url_list[0]
    const titleStr = `标题：${data.desc}\n`
    const authorStr = `作者：${data.author.nickname}${' '.repeat(32 - data.author.nickname.toString().length)}上传时间：${pubdate}\n`
    const likeStr = `喜欢：${digg_count}${' '.repeat(32 - digg_count.toString().length)}分享：${share_count}\n`
    const favoriteStr = `收藏：${collect_count}${' '.repeat(32 - collect_count.toString().length)}评论：${comment_count}`
    e.reply([
        segment.image(cover),
        '\n',
        '抖音视频\n',
        titleStr,
        authorStr,
        likeStr,
        favoriteStr
    ])
    const dirPath = 'resources/videoRealUrl/douyin'
    const realUrl = data.video_data.nwm_video_url_HQ
    const videoID = data.aweme_id
    const referer = 'https://www.douyin.com/'
    let filePath = await download(realUrl, videoID, dirPath, referer)
    return filePath
}

/**
 * 抖音视频解析
 * @param resUrl 需要解析的Url
 */
async function douyinRes(resUrl) {
    console.log('[抖音视频解析]', resUrl)
    let response = await fetch(resUrl)
    if (response.status === 200) {
        response = await response.json()
        return response
    } else {
        throw new Error('[抖音解析]解析失败，错误代码：', response.status)
    }
}

/**
 * 下载视频
 * @param realUrl 视频下载直链
 * @param videoID 视频的文件名，只在存储路径用到，可更改
 * @param dirPath 文件夹路径
 * @param referer 请求头
 * @returns 文件的下载路径
 */
let redirectCount = 0
async function download(realUrl, videoID, dirPath, referer) {
    console.log('[视频解析]下载视频', realUrl)
    mkdirs(dirPath)
    const options = {
        headers: {
            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/113.0.0.0 Safari/537.36',
            'referer': referer
        }
    }
    return new Promise((resolve, reject) => {
        https
            .get(realUrl, options, (res) => {
                if (res.statusCode === 302) {
                    if (redirectCount >= 5) {
                        reject(new Error('重定向次数过多，下载失败'));
                    }
                    redirectCount++;
                    const redirectUrl = res.headers.location;
                    resolve(download(redirectUrl, videoID, dirPath, referer));
                } else if (res.statusCode === 200) {
                    const fileType = res.headers['content-type'].split('/')[1]; //文件类型
                    if (fileType === 'json') {
                        reject(new Error('解析到一个json文件'));
                    }
                    const filePath = path.join(dirPath, `${videoID}.${fileType}`);
                    // 创建可写流并写入文件
                    const fileStream = fs.createWriteStream(filePath);
                    res.pipe(fileStream);
                    fileStream
                        .on('finish', () => {
                            console.log('文件下载完成');
                            resolve(filePath);
                        })
                        .on('error', (err) => {
                            reject(new Error(`下载发生错误：${err.message}`));
                        });
                } else {
                    reject(new Error(`下载失败，错误代码：${res.statusCode}`));
                }
            })
            .on('error', (err) => {
                reject(new Error(`下载发生错误：${err.message}`));
            });
    });

    // let videoResponse = await fetch(realUrl, {
    //     headers: {
    //         'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/113.0.0.0 Safari/537.36',
    //         referer: 'https://www.douyin.com/',
    //         bodySize: 104857600,
    //         timeout: 180000
    //     }
    // })
    // const fileType = videoResponse.headers.get('Content-Type').split('/')[1] //文件类型
    // const fileLength = videoResponse.headers.get('Content-Length') //文件大小
    // if (fileLength > 104857600) {
    //     console.log('[视频解析]文件大小超过100M，拒绝下载。防止出现死锁等问题。')
    //     return false
    // }
    // const resultBlob = await videoResponse.blob()
    // const resultArrayBuffer = await resultBlob.arrayBuffer()
    // const resultBuffer = Buffer.from(resultArrayBuffer)
    // fs.writeFileSync(path.join(dirPath, videoID + '.' + fileType), resultBuffer)
    // return fileType
}

/**
 * 创建文件夹
 * @param dirPath 文件夹路径
 * @returns 布尔值
 */
function mkdirs(dirPath) {
    if (fs.existsSync(dirPath)) {
        return true
    } else {
        if (mkdirs(path.dirname(dirPath))) {
            fs.mkdirSync(dirPath)
            return true
        }
    }
}

/**
 * 删除文件
 * @param filePath 文件路径
 * @returns 布尔值
 */
function delFile(filePath) {
    if (fs.existsSync(filePath)) {
        fs.unlinkSync(filePath)
        return true
    }
}

/**
 * 转换时间戳
 * @param pubdate 时间戳参数
 * @returns 人类能看懂的时间
 */
function timesTamp(pubdate) {
    const dateObj = new Date(pubdate * 1000); // 将时间戳转换为日期对象
    const year = dateObj.getFullYear(); // 获取年份
    const month = dateObj.getMonth() + 1; // 获取月份（需要加1，因为月份从0开始计数）
    const day = dateObj.getDate(); // 获取日期
    const hours = dateObj.getHours(); // 获取小时
    const minutes = dateObj.getMinutes(); // 获取分钟
    const seconds = dateObj.getSeconds(); // 获取秒数
    const formattedDate = `${year}-${month}-${day} ${hours}:${minutes}:${seconds}` // 将时间转换为字符串格式
    return formattedDate
}