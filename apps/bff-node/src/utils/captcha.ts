import { randomInt } from 'node:crypto'

// 去掉 0/O/1/I/l 这类字形接近的：演示时销售要照着图念给客人，认错一个就得重来
const ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789'
const WIDTH = 126
const HEIGHT = 40
const LENGTH = 4

export interface Captcha {
  /** 正确答案，已转大写。比对时两边都 toUpperCase()，对大小写不敏感 */
  text: string
  /** 可直接塞进 <img src> 的 data URI */
  image: string
}

/**
 * 生成图形验证码。
 *
 * 自己拼 SVG 而不是引 svg-captcha/canvas：加新依赖就得走 3-5 分钟的完整部署，
 * 而这点字符扭曲 + 干扰线的代码量还不如一次依赖升级的风险大。
 */
export function generateCaptcha(): Captcha {
  const chars = Array.from({ length: LENGTH }, () => ALPHABET[randomInt(ALPHABET.length)])
  const parts: string[] = []

  chars.forEach((char, i) => {
    const x = 16 + i * 26 + randomInt(-3, 4)
    const y = 28 + randomInt(-4, 5)
    const size = 24 + randomInt(0, 5)
    parts.push(
      `<text x="${x}" y="${y}" font-family="Arial,Helvetica,sans-serif" font-size="${size}" font-weight="bold"` +
      ` fill="hsl(${randomInt(0, 360)},62%,40%)" transform="rotate(${randomInt(-28, 29)} ${x} ${y})">${char}</text>`,
    )
  })

  for (let i = 0; i < 2; i++) {
    parts.push(
      `<path d="M0 ${randomInt(4, HEIGHT - 4)} Q ${WIDTH / 2} ${randomInt(0, HEIGHT)} ${WIDTH} ${randomInt(4, HEIGHT - 4)}"` +
      ` stroke="hsl(${randomInt(0, 360)},60%,62%)" stroke-width="1.5" fill="none"/>`,
    )
  }

  for (let i = 0; i < 24; i++) {
    parts.push(`<circle cx="${randomInt(0, WIDTH)}" cy="${randomInt(0, HEIGHT)}" r="1" fill="hsl(${randomInt(0, 360)},50%,62%)"/>`)
  }

  const svg =
    `<svg xmlns="http://www.w3.org/2000/svg" width="${WIDTH}" height="${HEIGHT}" viewBox="0 0 ${WIDTH} ${HEIGHT}">` +
    `<rect width="100%" height="100%" fill="#f4f6fa"/>${parts.join('')}</svg>`

  return {
    text: chars.join('').toUpperCase(),
    image: `data:image/svg+xml;base64,${Buffer.from(svg).toString('base64')}`,
  }
}
