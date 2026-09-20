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
    assert.equal(url, 'https://b23.tv/example')
    assert.equal(options.redirect, 'follow')
    return { url: 'https://www.bilibili.com/video/BVexample?share_source=copy_web' }
  })
  expectResult(await processLink('https://b23.tv/example'), 'https://www.bilibili.com/video/BVexample')
})
