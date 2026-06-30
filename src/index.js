export default {
  async fetch(request, env, ctx) {
    return handleRequest(request)
  }
}

async function handleRequest(request) {
  const { method } = request
  const parsedUrl = new URL(request.url)

  if (method === 'GET' && parsedUrl.pathname === '/') {
    const locale = resolveLocale(request, parsedUrl)
    return htmlResponse(renderHtmlPage('', locale), locale)
  } else if (method === 'POST' && parsedUrl.pathname === '/process') {
    const formData = await request.formData()
    const inputText = formData.get('inputText')
    const locale = resolveLocale(request, parsedUrl, formData.get('lang'))
    const t = translations[locale]

    if (!inputText) {
      return htmlResponse(renderHtmlPage(t.errEmpty, locale), locale)
    }

    try {
      const extractedUrl = extractUrlFromText(inputText)

      if (!extractedUrl) {
        return htmlResponse(renderHtmlPage(t.errNoLink, locale), locale)
      }

      let finalUrl;
      if (isShortLink(extractedUrl)) {
        finalUrl = await resolveUrl(extractedUrl) // 解析短链接
      } else {
        finalUrl = extractedUrl // 原始链接直接使用
      }

      const cleanUrl = forceHttps(await processUrlBasedOnDomain(finalUrl))

      return htmlResponse(renderResultPage(cleanUrl, locale), locale)
    } catch (error) {
      return htmlResponse(renderHtmlPage(t.errProcess, locale), locale)
    }
  } else {
    return new Response('Not Found', { status: 404 })
  }
}

// 统一构造 HTML 响应，并把当前语言写入 Cookie 以便记忆
function htmlResponse(html, locale) {
  return new Response(html, {
    headers: {
      'Content-Type': 'text/html; charset=UTF-8',
      'Set-Cookie': `lang=${locale}; Path=/; Max-Age=31536000; SameSite=Lax`
    }
  })
}

// ============================ 多语言文案 ============================
const DEFAULT_LOCALE = 'zh-Hans'

const translations = {
  'zh-Hans': {
    htmlLang: 'zh-Hans',
    homeTitle: '去除URL追踪工具',
    resultTitle: '清理结果',
    heading: '去链接追踪',
    placeholder: '粘贴包含链接的文本',
    submit: '去你的追踪参数！',
    supportedTitle: '支持的链接',
    platforms: {
      bilibili: '哔哩哔哩',
      xiaohongshu: '小红书',
      weixin: '微信公众号',
      music163: '网易云音乐',
      zhihu: '知乎'
    },
    tagShortLink: '含短链',
    supportedNote: '其他链接默认清除第一个?（英文问号）后的追踪参数。',
    resultHeading: '清理完成',
    resultLabel: '清理后的URL：',
    copy: '复制URL',
    back: '返回',
    copied: '已复制到剪贴板！',
    forked: '源代码：',
    errEmpty: '请输入有效的文本内容',
    errNoLink: '未在文本中找到有效链接',
    errProcess: '处理URL时出错，请检查链接是否有效。'
  },
  'zh-Hant': {
    htmlLang: 'zh-Hant',
    homeTitle: '去除URL追蹤工具',
    resultTitle: '清理結果',
    heading: '去連結追蹤',
    placeholder: '貼上包含連結的文字',
    submit: '去你的追蹤參數！',
    supportedTitle: '支援的連結',
    platforms: {
      bilibili: '嗶哩嗶哩',
      xiaohongshu: '小紅書',
      weixin: '微信公眾號',
      music163: '網易雲音樂',
      zhihu: '知乎'
    },
    tagShortLink: '含短連結',
    supportedNote: '其他連結預設清除第一個?（英文問號）後的追蹤參數。',
    resultHeading: '清理完成',
    resultLabel: '清理後的 URL：',
    copy: '複製 URL',
    back: '返回',
    copied: '已複製到剪貼簿！',
    forked: '原始碼：',
    errEmpty: '請輸入有效的文字內容',
    errNoLink: '未在文字中找到有效連結',
    errProcess: '處理 URL 時發生錯誤，請檢查連結是否有效。'
  },
  'en': {
    htmlLang: 'en',
    homeTitle: 'URL Tracker Remover',
    resultTitle: 'Result',
    heading: 'Strip Link Trackers',
    placeholder: 'Paste text containing a link',
    submit: 'Strip the trackers!',
    supportedTitle: 'Supported links',
    platforms: {
      bilibili: 'Bilibili',
      xiaohongshu: 'Xiaohongshu',
      weixin: 'WeChat Official Account',
      music163: 'NetEase Cloud Music',
      zhihu: 'Zhihu'
    },
    tagShortLink: 'incl. short links',
    supportedNote: 'For other links, tracking parameters after the first "?" are removed by default.',
    resultHeading: 'Done',
    resultLabel: 'Cleaned URL:',
    copy: 'Copy URL',
    back: 'Back',
    copied: 'Copied to clipboard!',
    forked: 'Source code:',
    errEmpty: 'Please enter some text.',
    errNoLink: 'No valid link found in the text.',
    errProcess: 'Something went wrong. Please check that the link is valid.'
  }
}

// 把任意语言标签归一化为受支持的 locale
function normalizeLocale(value) {
  if (!value) return null
  const v = value.toLowerCase()
  if (v.includes('zh')) {
    if (v.includes('tw') || v.includes('hk') || v.includes('mo') || v.includes('hant')) return 'zh-Hant'
    return 'zh-Hans'
  }
  if (v.includes('en')) return 'en'
  return null
}

// 读取指定 Cookie
function getCookie(request, name) {
  const cookie = request.headers.get('Cookie') || ''
  const match = cookie.match(new RegExp('(?:^|;\\s*)' + name + '=([^;]+)'))
  return match ? decodeURIComponent(match[1]) : null
}

// 语言判定：?lang= 手动选择 → Cookie 记忆 → 浏览器 Accept-Language → 默认
function resolveLocale(request, parsedUrl, formLang) {
  const explicit = normalizeLocale(parsedUrl.searchParams.get('lang') || formLang)
  if (explicit) return explicit

  const fromCookie = normalizeLocale(getCookie(request, 'lang'))
  if (fromCookie) return fromCookie

  const acceptLanguage = request.headers.get('Accept-Language') || ''
  for (const part of acceptLanguage.split(',')) {
    const norm = normalizeLocale(part.split(';')[0].trim())
    if (norm) return norm
  }

  return DEFAULT_LOCALE
}

// 支持的链接域名列表
const supportedDomains = {
  shortLinks: [
    't.co',
    'xhslink.com',
    '163cn.tv',
    'bili2233.cn',
    'b23.tv'
  ],
  xhslink: 'xiaohongshu.com',
  weixin: 'weixin',
  music163: 'music.163.com',
  bilibili: 'bilibili.com',
  zhihu: 'zhihu.com',
  other: 'default'
}

// 判断是否为短链接
function isShortLink(url) {
  const shortLinkRegex = new RegExp(`(${supportedDomains.shortLinks.join('|')})`);
  return shortLinkRegex.test(url);
}

// 提取URL
function extractUrlFromText(text) {
  const urlRegex = /(https?:\/\/[^\s]+)/g
  const matches = text.match(urlRegex)
  return matches ? matches[0] : null
}

// 解析短链接：跟随跳转拿到最终 URL
// 注意：部分短链服务（如 xhslink.com）对 HEAD 请求返回 404，只有 GET 才会发出跳转，
// 因此这里统一使用 GET（不读取响应体，仅取最终 URL）。
async function resolveUrl(url) {
  try {
    const response = await fetch(url, {
      method: 'GET',
      redirect: 'follow',
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36 Edg/131.0.0.0'
      }
    });
    return response.url
  } catch (error) {
    throw new Error('无法解析短链接')
  }
}

// 强制使用 https，避免把 http 链接返回给用户
function forceHttps(url) {
  try {
    const parsedUrl = new URL(url)
    parsedUrl.protocol = 'https:'
    return parsedUrl.toString()
  } catch (error) {
    return url
  }
}

// 根据域名处理URL
async function processUrlBasedOnDomain(url) {
  const parsedUrl = new URL(url)
  const hostname = parsedUrl.hostname

  // 小红书短链处理
  if (hostname.includes(supportedDomains.xhslink)) {
    const xsecToken = parsedUrl.searchParams.get('xsec_token');
    parsedUrl.search = '';
    if (xsecToken) {
      parsedUrl.searchParams.set('xsec_token', xsecToken);
    }
    parsedUrl.search += '&xsec_source=pc_user';
    return parsedUrl.toString();
  }

  // 微信公众号链接处理
  if (hostname.includes(supportedDomains.weixin)) {
    const chksmIndex = url.indexOf('&chksm')
    if (chksmIndex !== -1) {
      return url.substring(0, chksmIndex)
    } else {
      return url
    }
  }

  // 网易云音乐链接处理
  if (hostname.includes(supportedDomains.music163)) {
    const useridIndex = url.indexOf('&')
    if (useridIndex !== -1) {
      return url.substring(0, useridIndex)
    } else {
      return url
    }
  }

    // 推特处理
  if (hostname === 'x.com' || hostname === 'www.x.com') {
    parsedUrl.hostname = 'fixupx.com'; // 明确修改 URL 对象的主机名
    parsedUrl.search = '';             // 同时在此处清空查询参数
    return parsedUrl.toString();       // 直接返回修改后的结果
  }

  // 其他短链处理
  if (hostname.includes(supportedDomains.shortLinks)) {
    const resolvedUrl = await resolveUrl(url)
    const firstAmpersandIndex = resolvedUrl.indexOf('&')
    if (firstAmpersandIndex !== -1) {
      return resolvedUrl.substring(0, firstAmpersandIndex)
    } else {
      return resolvedUrl
    }
  }

  // 默认处理逻辑：清空查询参数
  parsedUrl.search = ''
  return parsedUrl.toString()
}

// 语言切换器（仅主页显示）
function renderLangSwitch(current) {
  const langs = [['zh-Hans', '简'], ['zh-Hant', '繁'], ['en', 'EN']]
  const links = langs.map(([code, label]) =>
    `<a href="/?lang=${code}"${code === current ? ' class="active"' : ''}>${label}</a>`
  ).join('')
  return `<div class="lang-switch">${links}</div>`
}

// 渲染主页
function renderHtmlPage(errorMessage = '', locale = DEFAULT_LOCALE) {
  const t = translations[locale]

  const platforms = [
    ['bilibili', true],
    ['music163', true],
    ['xiaohongshu', true],
    ['weixin', false],
    ['zhihu', false]
  ]
  const rows = platforms.map(([key, short]) =>
    `<li><span class="name">${t.platforms[key]}</span><span class="tag">${short ? t.tagShortLink : ''}</span></li>`
  ).join('\n                    ')

  return `
    <!DOCTYPE html>
    <html lang="${t.htmlLang}">
    <head>
        <meta charset="UTF-8">
        <meta name="viewport" content="width=device-width, initial-scale=1.0">
        <title>${t.homeTitle}</title>
        <style>
            body {
                font-family: Arial, sans-serif;
                background-color: #f4f4f4;
                margin: 0;
                padding: 0;
                display: flex;
                flex-direction: column;
                justify-content: center;
                align-items: center;
                height: 100vh;
            }
            .container {
                background-color: #fff;
                padding: 20px;
                border-radius: 8px;
                box-shadow: 0 0 10px rgba(0, 0, 0, 0.1);
                width: 320px;
                text-align: center;
            }
            .lang-switch {
                text-align: right;
                font-size: 12px;
                margin-bottom: 4px;
            }
            .lang-switch a {
                color: #aaa;
                text-decoration: none;
                margin-left: 10px;
            }
            .lang-switch a:hover {
                color: #007BFF;
            }
            .lang-switch a.active {
                color: #007BFF;
                font-weight: 600;
            }
            textarea, button {
                width: calc(100% - 20px);
                padding: 10px;
                margin: 10px 0;
                border-radius: 4px;
                border: 1px solid #ddd;
                font-size: 16px;
            }
            button {
                width: 100%;
                background-color: #007BFF;
                color: white;
                border: none;
                cursor: pointer;
            }
            button:hover {
                background-color: #0056b3;
            }
            .error {
                color: red;
                margin-bottom: 10px;
            }
            .supported {
                margin-top: 20px;
                text-align: left;
            }
            .supported-title {
                font-size: 13px;
                color: #888;
                margin: 0 0 8px;
            }
            .rows {
                list-style: none;
                padding: 0;
                margin: 0;
            }
            .rows li {
                display: flex;
                justify-content: space-between;
                align-items: center;
                padding: 9px 0;
                border-bottom: 1px solid #f0f0f0;
                font-size: 13px;
            }
            .rows li:last-child {
                border-bottom: none;
            }
            .rows .name {
                color: #333;
            }
            .rows .tag {
                color: #aaa;
                font-size: 12px;
            }
            .supported-note {
                margin-top: 12px;
                font-size: 12px;
                color: #aaa;
                line-height: 1.5;
            }
            .footer {
                margin-top: 24px;
                padding-top: 16px;
                border-top: 1px solid #f0f0f0;
                font-size: 12px;
                color: #aaa;
                text-align: center;
                line-height: 1.9;
            }
            .footer p {
                margin: 0;
            }
            .footer a {
                color: #007BFF;
                text-decoration: none;
            }
            .footer a:hover {
                text-decoration: underline;
            }
        </style>
    </head>
    <body>
        <div class="container">
            ${renderLangSwitch(locale)}
            <h2>${t.heading}</h2>
            ${errorMessage ? `<div class="error">${errorMessage}</div>` : ''}
            <form method="POST" action="/process">
                <input type="hidden" name="lang" value="${locale}">
                <textarea name="inputText" placeholder="${t.placeholder}" rows="6" required></textarea>
                <button type="submit">${t.submit}</button>
            </form>
            <div class="supported">
                <p class="supported-title">${t.supportedTitle}</p>
                <ul class="rows">
                    ${rows}
                </ul>
                <p class="supported-note">${t.supportedNote}</p>
            </div>
            <div class="footer">
                <p>© 2026 澈海秋光</p>
                <p>${t.forked} <a href="https://github.com/hoicau/rmtrackers" target="_blank" rel="noopener">leez233/hoicau/rmtrackers</a></p>
            </div>
        </div>
    </body>
    </html>
  `
}

// 渲染清理结果页面
function renderResultPage(cleanUrl, locale = DEFAULT_LOCALE) {
  const t = translations[locale]

  return `
    <!DOCTYPE html>
    <html lang="${t.htmlLang}">
    <head>
        <meta charset="UTF-8">
        <meta name="viewport" content="width=device-width, initial-scale=1.0">
        <title>${t.resultTitle}</title>
        <style>
            body {
                font-family: Arial, sans-serif;
                background-color: #f4f4f4;
                margin: 0;
                padding: 0;
                display: flex;
                flex-direction: column;
                justify-content: center;
                align-items: center;
                height: 100vh;
            }
            .container {
                background-color: #fff;
                padding: 20px;
                border-radius: 8px;
                box-shadow: 0 0 10px rgba(0, 0, 0, 0.1);
                width: 320px;
                text-align: center;
            }
            .result {
                margin-top: 20px;
                word-wrap: break-word;
            }
            a {
                color: #007BFF;
                text-decoration: none;
                word-wrap: break-word;
            }
            a:hover {
                text-decoration: underline;
            }
            .button-container {
                margin-top: 20px;
            }
            button {
                width: 100%; /* 按钮仍然占满容器宽度 */
                background-color: #007BFF;
                color: white;
                border: none;
                cursor: pointer;
                padding: 15px; /* 增大按钮的内边距 */
                font-size: 18px; /* 增大字体大小 */
                border-radius: 8px; /* 圆角按钮 */
                margin: 5px 0;
                transition: background-color 0.3s;
            }
            button:hover {
                background-color: #0056b3;
            }
            .footer {
                margin-top: 24px;
                padding-top: 16px;
                border-top: 1px solid #f0f0f0;
                font-size: 12px;
                color: #aaa;
                text-align: center;
                line-height: 1.9;
            }
            .footer p {
                margin: 0;
            }
            .footer a {
                color: #007BFF;
                text-decoration: none;
            }
            .footer a:hover {
                text-decoration: underline;
            }
        </style>
    </head>
    <body>
        <div class="container">
            <h2>${t.resultHeading}</h2>
            <div class="result">
                <p>${t.resultLabel}</p>
                <a href="${cleanUrl}" target="_blank" id="cleanUrl">${cleanUrl}</a>
            </div>
            <div class="button-container">
                <button id="copyButton">${t.copy}</button>
                <button onclick="window.location.href = '/'">${t.back}</button>
            </div>
            <div id="copyMessage" style="color: green; margin-top: 10px; display: none;">${t.copied}</div>
            <script>
                const copyButton = document.getElementById('copyButton');
                const cleanUrl = document.getElementById('cleanUrl').textContent;
                copyButton.addEventListener('click', () => {
                    navigator.clipboard.writeText(cleanUrl).then(() => {
                        document.getElementById('copyMessage').style.display = 'block';
                    });
                });
            </script>
            <div class="footer">
                <p>© 2026 澈海秋光</p>
                <p>${t.forked} <a href="https://github.com/leez233/tracker-remover" target="_blank" rel="noopener">leez233/tracker-remover</a></p>
            </div>
        </div>
    </body>
    </html>
  `;
}
