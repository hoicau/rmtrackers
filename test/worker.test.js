import assert from 'node:assert/strict'
import { mock, test, afterEach } from 'node:test'
import worker from '../src/index.js'

afterEach(() => mock.restoreAll())

const noteId = '694fd1d7000000001f00b8a3'
const note = `https://www.xiaohongshu.com/discovery/item/${noteId}`
const sharedNote = `${note}?appuid=tracking&xsec_token=test%2Btoken%3D&xsec_source=app_share&share_id=tracking`
const cleanedNote = `${note}?xsec_token=test%2Btoken%3D&xsec_source=app_share`

async function processLink(link) {
  const request = new Request('https://worker.example/process', {
    method: 'POST',
    body: new URLSearchParams({ inputText: `分享链接 ${link} 复制后打开`, lang: 'en' })
  })
  const response = await worker.fetch(request)
  return response.text()
}

function expectResult(html, url) {
  assert.ok(html.includes(`<a href="${url}" target="_blank" id="cleanUrl">${url}</a>`))
}

function expectError(html) {
  assert.ok(html.includes('Something went wrong. Please check that the link is valid.'))
  assert.ok(!html.includes('id="cleanUrl"'))
}

function mockRedirects(steps) {
  let index = 0
  return mock.method(globalThis, 'fetch', async (url, options) => {
    assert.ok(index < steps.length, `Unexpected request: ${url}`)
    const step = steps[index++]
    assert.equal(url, step.url)
    assert.equal(options.method, 'GET')
    assert.equal(options.redirect, 'manual')
    return new Response(null, {
      status: step.status ?? 302,
      headers: step.location ? { Location: step.location } : {}
    })
  })
}

for (const host of ['xhslink.com', 'xhslink.cn']) {
  test(`${host}: stops at the content URL before it can redirect to login`, async () => {
    const short = `http://${host}/o/example`
    const fetchMock = mockRedirects([{ url: short, location: sharedNote }])
    expectResult(await processLink(short), cleanedNote)
    assert.equal(fetchMock.mock.callCount(), 1)
  })
}

test('follows relative redirects and redirects between short-link domains', async () => {
  const fetchMock = mockRedirects([
    { url: 'https://xhslink.com/o/example', location: '/next', status: 301 },
    { url: 'https://xhslink.com/next', location: 'https://xhslink.cn/final', status: 307 },
    { url: 'https://xhslink.cn/final', location: sharedNote, status: 308 }
  ])
  expectResult(await processLink('https://xhslink.com/o/example'), cleanedNote)
  assert.equal(fetchMock.mock.callCount(), 3)
})

test('recovers a content URL when the short link points straight to login', async () => {
  const fetchMock = mockRedirects([{
    url: 'https://xhslink.com/o/example',
    location: `https://www.xiaohongshu.com/login?redirectPath=${encodeURIComponent(sharedNote)}`
  }])
  expectResult(await processLink('https://xhslink.com/o/example'), cleanedNote)
  assert.equal(fetchMock.mock.callCount(), 1)
})

for (const target of [sharedNote, new URL(sharedNote).pathname + new URL(sharedNote).search]) {
  test(`recovers a pasted login URL with ${target.startsWith('https:') ? 'absolute' : 'relative'} redirectPath`, async () => {
    const fetchMock = mockRedirects([])
    expectResult(await processLink(`https://www.xiaohongshu.com/login?redirectPath=${encodeURIComponent(target)}`), cleanedNote)
    assert.equal(fetchMock.mock.callCount(), 0)
  })
}

for (const path of [`/explore/${noteId}`, `/discovery/item/${noteId}`, `/user/profile/${noteId}`, `/user/profile/${noteId}/${noteId}`]) {
  test(`cleans direct content links without fetching: ${path}`, async () => {
    const fetchMock = mockRedirects([])
    expectResult(await processLink(`http://www.xiaohongshu.com${path}?xsec_token=abc%3D&xsec_source=pc_share&share_id=tracking#tracking`),
      `https://www.xiaohongshu.com${path}?xsec_token=abc%3D&xsec_source=pc_share`)
    assert.equal(fetchMock.mock.callCount(), 0)
  })
}

test('does not invent missing access parameters', async () => {
  mockRedirects([])
  expectResult(await processLink(`${note}?share_id=tracking`), note)
  expectResult(await processLink(`${note}?xsec_token=abc&share_id=tracking`), `${note}?xsec_token=abc`)
})

for (const target of [
  'https://www.xiaohongshu.com/login',
  'https://www.xiaohongshu.com/404/sec_test',
  'https://www.xiaohongshu.com/explore',
  `https://www.xiaohongshu.com/login?redirectPath=${encodeURIComponent(`https://xiaohongshu.com.evil.example/explore/${noteId}`)}`,
  `https://www.xiaohongshu.com/login?redirectPath=${encodeURIComponent(`https://evil.example/?next=${note}`)}`,
  `https://www.xiaohongshu.com/login?redirectPath=${encodeURIComponent(`ftp://www.xiaohongshu.com/explore/${noteId}`)}`,
  `https://www.xiaohongshu.com/login?redirectPath=${encodeURIComponent('https://[')}`
]) {
  test(`rejects login or error URLs without a valid content target: ${target}`, async () => {
    const fetchMock = mockRedirects([])
    expectError(await processLink(target))
    assert.equal(fetchMock.mock.callCount(), 0)
  })
}

for (const step of [
  { status: 200 },
  { status: 404 },
  { status: 302 },
  { location: 'https://www.xiaohongshu.com/login' },
  { location: 'https://www.xiaohongshu.com/' },
  { location: 'https://www.xiaohongshu.com/404/sec_test' },
  { location: `https://evil.example/explore/${noteId}` },
  { location: 'file:///tmp/example' }
]) {
  test(`fails safely on an unresolved short link: ${JSON.stringify(step)}`, async () => {
    const fetchMock = mockRedirects([{ url: 'https://xhslink.com/o/example', ...step }])
    expectError(await processLink('https://xhslink.com/o/example'))
    assert.equal(fetchMock.mock.callCount(), 1)
  })
}

test('stops redirect loops', async () => {
  const short = 'https://xhslink.com/o/example'
  const fetchMock = mockRedirects([{ url: short, location: short }])
  expectError(await processLink(short))
  assert.equal(fetchMock.mock.callCount(), 1)
})

for (const resolves of [true, false]) {
  test(`bounds redirect chains (${resolves ? 'content at limit' : 'limit exceeded'})`, async () => {
    const steps = Array.from({ length: 10 }, (_, index) => ({
      url: `https://xhslink.com/${index}`,
      location: resolves && index === 9 ? sharedNote : `https://xhslink.com/${index + 1}`
    }))
    const fetchMock = mockRedirects(steps)
    const html = await processLink('https://xhslink.com/0')
    if (resolves) expectResult(html, cleanedNote)
    else expectError(html)
    assert.equal(fetchMock.mock.callCount(), 10)
  })
}

test('reports network failures', async () => {
  mock.method(globalThis, 'fetch', async () => { throw new TypeError('fetch failed') })
  expectError(await processLink('https://xhslink.cn/o/example'))
})

test('matches short-link hosts instead of substrings in arbitrary URLs', async () => {
  const fetchMock = mockRedirects([])
  expectResult(await processLink('https://example.com/?next=https://xhslink.com/o/example'), 'https://example.com/')
  expectResult(await processLink('https://xhslink.com.evil.example/page?share_id=tracking'), 'https://xhslink.com.evil.example/page')
  assert.equal(fetchMock.mock.callCount(), 0)
})

test('preserves resolution and cleaning for other short-link services', async () => {
  mock.method(globalThis, 'fetch', async (url, options) => {
    assert.equal(url, 'https://t.co/example')
    assert.equal(options.redirect, 'follow')
    return { url: 'https://x.com/example/status/123?s=20' }
  })
  expectResult(await processLink('https://t.co/example'), 'https://fixupx.com/example/status/123')
})

for (const input of [
  '[https://example.com/article](https://example.com/article)',
  '[文章](https://example.com/article)',
  '[https://example.org/label](https://example.com/article)',
  '[文章](https://example.com/article "标题")',
  '[文章](<https://example.com/article>)',
  '[https://example.org/label](<https://example.com/article>)',
  '<https://example.com/article>',
  '(https://example.com/article)',
  '[https://example.com/article]',
  '`https://example.com/article`'
]) {
  test(`extracts a URL from formatted input: ${input}`, async () => {
    const fetchMock = mockRedirects([])
    expectResult(await processLink(input), 'https://example.com/article')
    assert.equal(fetchMock.mock.callCount(), 0)
  })
}

for (const [input, expected] of [
  ['[article](https://example.com/wiki/Example_(topic)?utm_source=share)', 'https://example.com/wiki/Example_(topic)'],
  ['(https://example.com/a_(b_(c)))', 'https://example.com/a_(b_(c))'],
  ['<http://[::1]/?utm_source=share>', 'https://[::1]/'],
  ['[http://[::1]]', 'https://[::1]/'],
  ['https://example.com/first [second](https://example.com/second)', 'https://example.com/first']
]) {
  test(`preserves URL syntax and first-link order: ${input}`, async () => {
    const fetchMock = mockRedirects([])
    expectResult(await processLink(input), expected)
    assert.equal(fetchMock.mock.callCount(), 0)
  })
}

for (const [input, expected] of [
  ['https://example.com/article?utm_source=share', 'https://example.com/article'],
  ['https://www.bilibili.com/video/BVexample?p=2&share_source=COPY', 'https://www.bilibili.com/video/BVexample?p=2'],
  [sharedNote, cleanedNote],
  ['https://music.163.com/song?id=123&userid=tracking', 'https://music.163.com/song?id=123'],
  ['https://mp.weixin.qq.com/s?__biz=example&mid=123&chksm=tracking', 'https://mp.weixin.qq.com/s?__biz=example&mid=123'],
  ['https://www.zhihu.com/question/123?utm_source=share', 'https://www.zhihu.com/question/123'],
  ['https://x.com/example/status/123?s=20', 'https://fixupx.com/example/status/123']
]) {
  test(`cleans Markdown destinations across domains: ${new URL(input).hostname}`, async () => {
    const fetchMock = mockRedirects([])
    expectResult(await processLink(`[分享](${input})`), expected)
    assert.equal(fetchMock.mock.callCount(), 0)
  })
}

const video = 'https://www.bilibili.com/video/BVexample'
const sharedVideo = `${video}?buvid=tracking&p=1&share_source=COPY&share_session_id=tracking`

for (const host of ['b23.tv', 'bili2233.cn']) {
  test(`${host}: resolves a share without requesting the video page`, async () => {
    const short = `https://${host}/example`
    const fetchMock = mockRedirects([
      { url: short, location: sharedVideo },
      { url: short, location: sharedVideo }
    ])
    expectResult(await processLink(short), video)
    expectResult(await processLink(`[${short}](${short})`), video)
    assert.equal(fetchMock.mock.callCount(), 2)
  })
}

test('Bilibili follows relative redirects and both short-link domains', async () => {
  const fetchMock = mockRedirects([
    { url: 'http://bili2233.cn/example', location: 'https://bili2233.cn/example', status: 301 },
    { url: 'https://bili2233.cn/example', location: 'https://b23.tv/example', status: 303 },
    { url: 'https://b23.tv/example', location: '/next', status: 307 },
    { url: 'https://b23.tv/next', location: sharedVideo, status: 308 }
  ])
  expectResult(await processLink('http://bili2233.cn/example'), video)
  assert.equal(fetchMock.mock.callCount(), 4)
})

test('Bilibili preserves the selected video part when removing tracking', async () => {
  const fetchMock = mockRedirects([{
    url: 'https://b23.tv/example', location: `${video}?share_source=COPY&p=3#tracking`
  }])
  expectResult(await processLink('https://b23.tv/example'), `${video}?p=3`)
  expectResult(await processLink(`${video}?p=2&share_source=COPY#tracking`), `${video}?p=2`)
  assert.equal(fetchMock.mock.callCount(), 1)
})

for (const page of ['1', '0', '-1', 'abc', '2.5']) {
  test(`Bilibili removes redundant or invalid video part: ${page}`, async () => {
    const fetchMock = mockRedirects([])
    expectResult(await processLink(`${video}?p=${page}&share_source=COPY`), video)
    assert.equal(fetchMock.mock.callCount(), 0)
  })
}

for (const target of [
  'https://space.bilibili.com/123',
  'https://live.bilibili.com/123',
  'https://www.bilibili.com/bangumi/play/ep123'
]) {
  test(`Bilibili resolves other shared content: ${target}`, async () => {
    const fetchMock = mockRedirects([{ url: 'https://b23.tv/example', location: `${target}?share_source=COPY#tracking` }])
    expectResult(await processLink('https://b23.tv/example'), target)
    assert.equal(fetchMock.mock.callCount(), 1)
  })
}

for (const step of [
  { status: 200 },
  { status: 525 },
  { status: 302 },
  { status: 200, location: sharedVideo },
  { location: 'https://b23.tv/example' },
  { location: 'https://bilibili.com.evil.example/video/123' },
  { location: 'https://b23.tv.evil.example/example' },
  { location: 'ftp://www.bilibili.com/video/123' },
  { location: 'https://user:password@www.bilibili.com/video/123' },
  { location: 'https://[' }
]) {
  test(`Bilibili rejects unresolved or invalid redirects: ${JSON.stringify(step)}`, async () => {
    const fetchMock = mockRedirects([{ url: 'https://b23.tv/example', ...step }])
    expectError(await processLink('https://b23.tv/example'))
    assert.equal(fetchMock.mock.callCount(), 1)
  })
}

for (const resolves of [true, false]) {
  test(`Bilibili bounds redirect chains (${resolves ? 'target at limit' : 'limit exceeded'})`, async () => {
    const steps = Array.from({ length: 10 }, (_, index) => ({
      url: `https://b23.tv/${index}`,
      location: resolves && index === 9 ? sharedVideo : `https://b23.tv/${index + 1}`
    }))
    const fetchMock = mockRedirects(steps)
    const html = await processLink('https://b23.tv/0')
    if (resolves) expectResult(html, video)
    else expectError(html)
    assert.equal(fetchMock.mock.callCount(), 10)
  })
}

for (const error of [new TypeError('fetch failed'), new DOMException('Timed out', 'TimeoutError')]) {
  test(`Bilibili reports request failures: ${error.name}`, async () => {
    mock.method(globalThis, 'fetch', async () => { throw error })
    expectError(await processLink('https://b23.tv/example'))
  })
}

test('Bilibili uses a valid Location even when discarding the response body fails', async () => {
  let cancelled = false
  mock.method(globalThis, 'fetch', async () => new Response(new ReadableStream({
    cancel() {
      cancelled = true
      throw new Error('Connection closed while cancelling')
    }
  }), { status: 302, headers: { Location: sharedVideo } }))
  expectResult(await processLink('https://b23.tv/example'), video)
  assert.ok(cancelled)
})
