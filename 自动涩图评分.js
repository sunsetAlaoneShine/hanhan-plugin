import plugin from '../../lib/plugins/plugin.js'
import tf from "@tensorflow/tfjs-node"
import nsfw from "nsfwjs"
import https from 'https'
import fs from "fs"
import path from 'node:path'
//import axios from 'axios'


/**
 * 一个很简单的插件。
 * 需要安装依赖``` pnpm i @tensorflow/tfjs-node nsfwjs -w ```
 * 详见https://www.npmjs.com/package/nsfwjs#node-js-app
 * 如果同时使用自动扫描二维码和自动色图评分，或许你应该在图片处理上共用一套逻辑。
 * 加载模型后内存占用较高，您可以尝试将config/pm2/pm2.json里面的max_memory_restart字段的值改成1G，例如"max_memory_restart": "1G"
 */

/**
 * nsfw检测模型路径，模型不存在则加载联网模型，脚本会自动将模型保存到本地，无需手动配置。
 * “.”表示云崽根目录。一个文件夹内应包含一个model.json文件和若干个二进制文件。你也可以自己修改成其他路径，模型放进去就行。
 * 模型下载地址：https://github.com/GantMan/nsfw_model/releases，经过少量样本对照，nsfw_mobilenet_v2_140_224.zip 135 MB 版本审查的准确率更高。
 */
const modelPath = './web_model_quantized/model.json'

let loadedModel = null
export class nsfwImageCheck extends plugin {
  constructor() {
    super({
      name: '自动色图评分',
      dsc: '简单开发示例',
      event: 'message',
      priority: 5050,
      rule: [
        {
          fnc: 'nsfwImageCheck'
        }
      ]
    })
  }

  async nsfwImageCheck() {
    // 检查消息类型
    // console.log('debug', this.e.message)
    // if (this.e.message[0].type !== 'image' || !this.e.message[0].url) {
    //   return false
    // }
    // const imageUrl = this.e.message[0].url

    const imageMsg = this.e.message.find(msg => msg.type === 'image') || null
    if (!imageMsg?.url || imageMsg.file.endsWith('.gif')) {
      return false
    }
    const imageUrl = imageMsg.url
    const regex = /-(\w{32})\//
    const hash = imageUrl.match(regex)[1]
    if (await redis.exists(`Yz:nsfwCheck:${hash}`)) {
      logger.info('[涩图评分]图片安全，重置缓存时间')
      await redis.expire(`Yz:nsfwCheck:${hash}`, 36 * 60 * 60)
      return false
    }

    const buffer = await getImageBuffer(imageUrl)
    const uint8Array = new Uint8Array(buffer)

    // const pic = await axios.get(imageUrl, {
    //   responseType: 'arraybuffer',
    // })
    //const model = await nsfw.load()

    // 将await nsfw.load()作为一个独立的方法或者模块，可以防止每次运行脚本都加载一次模型，解决了内存泄露问题
    const model = await loadModel()
    const image = await tf.node.decodeImage(uint8Array, 3)
    const predictions = await model.classify(image)
    image.dispose() // 张量的内存必须显式地进行管理（仅仅使 tf.Tensor 超出范围不足以释放其内存）。
    console.log(predictions)

    if (predictions[0].className === 'Hentai') {
      this.e.reply(`好涩 (*/ω\\*) ，Hentai分数：${predictions[0].probability}`)
    } else if (predictions[0].className === 'Porn') {
      this.e.reply(`太变态啦，这是能发出来的嘛？，色情概率：${predictions[0].probability}`)
    } else if (predictions[0].className === 'Sexy') {
      this.e.reply(`好性感，依米也可以哦，涩度：${predictions[0].probability}`)
    } else {
      await redis.set(`Yz:nsfwCheck:${hash}`, '0', { EX: 24 * 60 * 60 })
      return false
    }
    return true
  }
}

async function getImageBuffer(imageUrl) {
  return new Promise((resolve, reject) => {
    https.get(imageUrl, (response) => {
      if (response.statusCode !== 200) {
        reject(new Error(`Request failed with status code ${response.statusCode}`))
        return
      }

      const chunks = []

      response.on('data', (chunk) => {
        chunks.push(chunk)
      })

      response.on('end', () => {
        const buffer = Buffer.concat(chunks)
        resolve(buffer)
      })

      response.on('error', (error) => {
        reject(new Error(`Resource download failed with error code ${error}`))
      })
    })
  })
}

async function loadModel() {
  if (!loadedModel) {
    const defModelPath = './data/def_nsfw_check_model/model.json'
    const modelPathChoice = fs.existsSync(modelPath) ? modelPath : (fs.existsSync(defModelPath) ? defModelPath : null)
    if (modelPathChoice) {
      // 如果模型已存在，则加载本地模型
      logger.info('[图片审查]模型存在，尝试载入本地模型')
      const ioHandler = tf.io.fileSystem(modelPathChoice)
      loadedModel = await nsfw.load(ioHandler, { type: modelPathChoice === modelPath ? 'graph' : 224 })
    } else {
      // 如果模型不存在，则从网络加载模型
      logger.info('[图片审查]模型不存在，尝试加载联网模型')
      const defPath = './data/def_nsfw_check_model/'
      mkdirs(defPath)
      loadedModel = await nsfw.load()
      // 保存模型到本地，代码是天上掉下来的
      await loadedModel.model.save(tf.io.fileSystem(defPath))
      logger.info(`模型已保存到${defPath}`)
    }
  }
  return loadedModel
}

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
