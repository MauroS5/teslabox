const config = require('../config')
const log = require('../log')
const ping = require('../ping')
const ses = require('../aws/ses')
const telegram = require('../telegram')

const _ = require('lodash')
const fs = require('fs')
const async = require('async')
const Queue = require('better-queue')

const settings = {
  appUrl: 'https://ownership.tesla.com/en_us/get-app',
  concurrent: 1,
  maxRetries: Infinity,
  retryDelay: 10000
}

let q

exports.start = (cb) => {
  cb = cb || function () {}

  const params = {
    concurrent: settings.concurrent,
    maxRetries: settings.maxRetries,
    retryDelay: settings.retryDelay
  }

  q = new Queue((input, cb) => {
    async.series([
      (cb) => {
        if (!ping.isAlive()) {
          return cb(true)
        }

        cb()
      },
      (cb) => {
        if (input.step !== 1) {
          return cb()
        }

        if (!input.telegramRecipients.length) {
          input.step++
          return cb()
        }

        let text = input.text
        if (!text) {
          text = `${input.carName} ${_.upperFirst(input.event.type)}`
          if (input.event.type === 'sentry') text += ` (${_.upperFirst(input.event.angle)})`
          text += ` ${input.event.datetime}`
          text += `\n[Map](https://www.google.com/maps?q=${input.event.est_lat},${input.event.est_lon})`
          text += ` | [App](${settings.appUrl})`
        }

        if (input.shortFile) {
          text += ` | [Video](${input.videoUrl})`

          telegram.sendAnimation(input.telegramRecipients, input.shortFile, input.shortKey, text, (err) => {
            fs.rm(input.shortFile, () => {})

            if (!err) {
              input.step++
              log.debug(`[queue/notify] ${input.id} telegramed short ${input.telegramRecipients.join(',')} after ${+new Date() - input.startedAt}ms`)
            }

            cb(err)
          })
        } else if (input.videoUrl) {
          text += ` | [Video](${input.videoUrl})`

          telegram.sendVideo(input.telegramRecipients, input.videoUrl, text, (err) => {
            if (!err) {
              input.step++
              log.debug(`[queue/notify] ${input.id} telegramed video ${input.telegramRecipients.join(',')} after ${+new Date() - input.startedAt}ms`)
            }

            cb(err)
          })
        } else {
          telegram.sendMessage(input.telegramRecipients, text, (err) => {
            if (!err) {
              input.step++
              log.debug(`[queue/notify] ${input.id} telegramed message ${input.telegramRecipients.join(',')} after ${+new Date() - input.startedAt}ms`)
            }

            cb(err)
          })
        }
      },
      (cb) => {
        if (input.step !== 2) {
          return cb()
        }

        if (!input.emailRecipients.length) {
          input.step++
          return cb()
        }

        let subject = input.subject
        if (!subject) {
          subject = `TeslaBox ${input.carName} ${_.upperFirst(input.event.type)}`
          if (input.event.type === 'sentry') subject += ` (${_.upperFirst(input.event.angle)})`
          subject += ` ${input.event.datetime}`
        }

        let text = input.text
        if (!text) {
          text = `Map: <https://www.google.com/maps?q=${input.event.est_lat},${input.event.est_lon}>`
          text += `\nApp: <${settings.appUrl}>`
          if (input.shortUrl && input.shortUrl.startsWith('https://')) text += `\nShort: <${input.shortUrl}>`
          if (input.videoUrl) text += `\nVideo: <${input.videoUrl}>`
        }

        let html = input.html
        if (!html) {
          html = `<a href="https://www.google.com/maps?q=${input.event.est_lat},${input.event.est_lon}" target="_blank">Map</a>`
          html += ` | <a href="${settings.appUrl}" target="_blank">App</a>`
          if (input.videoUrl) html += ` | <a href="${input.videoUrl}" target="_blank">Video</a>`
        }

        ses.sendEmail(input.emailRecipients, subject, text, html, (err) => {
          if (!err) {
            input.step++
            log.debug(`[queue/notify] ${input.id} emailed ${input.emailRecipients.join(',')} after ${+new Date() - input.startedAt}ms`)
          }

          cb(err)
        })
      }
    ], (err) => {
      if (err === true || input.step === 1) {
        log.warn(`[queue/notify] ${input.id} stalled: no connection`)
      } else if (err) {
        log.error(`[queue/notify] ${input.id} failed: ${err}`)
        q.cancel(input.id)
      }

      cb(err)
    })
  }, params)

  cb()
}

exports.push = (input) => {
  _.assign(input, {
    carName: config.get('carName'),
    emailRecipients: config.get('emailRecipients'),
    telegramRecipients: config.get('telegramRecipients'),
    startedAt: +new Date(),
    step: 1
  })

  q.push(input)
  log.debug(`[queue/notify] ${input.id} queued`)
}
