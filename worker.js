addEventListener('fetch', event => {
  event.respondWith(handleRequest(event.request))
})

async function handleRequest(request) {
  const { method, url } = request
  const parsedUrl = new URL(url)

  if (method === 'GET' && parsedUrl.pathname === '/') {
    return new Response(renderHtmlPage(), {
      headers: { 'Content-Type': 'text/html' }
    })
  } else if (method === 'POST' && parsedUrl.pathname === '/process') {
    const formData = await request.formData()
    const inputText = formData.get('inputText')

    if (!inputText) {
      return new Response(renderHtmlPage('请输入有效的文本内容'), {
        headers: { 'Content-Type': 'text/html' }
      })
    }

    try {
      const extractedUrl = extractUrlFromText(inputText)

      if (!extractedUrl) {
        return new Response(renderHtmlPage('未在文本中找到有效链接'), {
          headers: { 'Content-Type': 'text/html' }
        })
      }

      let finalUrl;
      if (isShortLink(extractedUrl)) {
        finalUrl = await resolveUrl(extractedUrl) // 解析短链接
      } else {
        finalUrl = extractedUrl // 原始链接直接使用
      }

      const cleanUrl = await processUrlBasedOnDomain(finalUrl)

      return new Response(renderResultPage(cleanUrl), {
        headers: { 'Content-Type': 'text/html' }
      })
    } catch (error) {
      return new Response(renderHtmlPage('处理URL时出错，请检查链接是否有效。'), {
        headers: { 'Content-Type': 'text/html' }
      })
    }
  } else {
    return new Response('Not Found', { status: 404 })
  }
}

// 支持的链接域名列表
const supportedDomains = {
  shortLinks: [
    't.co',
    'xhslink.com',
    '163cn.tv',
    'b23.tv'
  ],
  xhslink: 'xiaohongshu.com',
  weixin: 'weixin',
  music163: 'music.163.com',
  bsite: 'bilibili.com',
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

// 解析短链接
async function resolveUrl(url) {
  try {
    const response = await fetch(url, {
      method: 'HEAD',
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

// 渲染主页
function renderHtmlPage(errorMessage = '') {
  return `
    <!DOCTYPE html>
    <html lang="zh-CN">
    <head>
        <meta charset="UTF-8">
        <meta name="viewport" content="width=device-width, initial-scale=1.0">
        <title>去除URL追踪工具</title>
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
            .info {
                margin-top: 20px;
                font-size: 14px;
                color: #555;
                text-align: left;
            }
        </style>
    </head>
    <body>
        <div class="container">
            <h2>去除追踪参数</h2>
            ${errorMessage ? `<div class="error">${errorMessage}</div>` : ''}
            <form method="POST" action="/process">
                <textarea name="inputText" placeholder="粘贴包含链接的文本" rows="6" required></textarea>
                <button type="submit">处理文本</button>
            </form>
            <div class="info">
                <p>支持的链接：</p>
                <ul>
                    <li>小红书及其短链</li>
                    <li>微信公众号</li>
                    <li>网易云音乐及其短链</li>
                    <li>B站及其短链</li>
                    <li>知乎</li>
                    <li>其他域名采用默认处理逻辑（清空第一个?后的查询参数）</li>
                </ul>
            </div>
        </div>
    </body>
    </html>
  `
}

// 渲染处理结果页面
function renderResultPage(cleanUrl) {
  return `
    <!DOCTYPE html>
    <html lang="zh-CN">
    <head>
        <meta charset="UTF-8">
        <meta name="viewport" content="width=device-width, initial-scale=1.0">
        <title>处理结果</title>
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
        </style>
    </head>
    <body>
        <div class="container">
            <h2>处理完成</h2>
            <div class="result">
                <p>清理后的URL：</p>
                <a href="${cleanUrl}" target="_blank" id="cleanUrl">${cleanUrl}</a>
            </div>
            <div class="button-container">
                <button id="copyButton">复制URL</button>
                <button onclick="window.location.href = '/'">返回</button>
            </div>
            <div id="copyMessage" style="color: green; margin-top: 10px; display: none;">已复制到剪贴板!</div>
            <script>
                const copyButton = document.getElementById('copyButton');
                const cleanUrl = document.getElementById('cleanUrl').textContent;
                copyButton.addEventListener('click', () => {
                    navigator.clipboard.writeText(cleanUrl).then(() => {
                        document.getElementById('copyMessage').style.display = 'block';
                    });
                });
            </script>
        </div>
    </body>
    </html>
  `;
}
