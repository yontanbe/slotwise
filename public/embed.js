/*
 * Slotwise embed. Usage:
 *   <div data-slotwise="https://you.github.io/slotwise/#/yonatan/intro"></div>
 *   <script src="https://you.github.io/slotwise/embed.js" async></script>
 * or
 *   <button onclick="Slotwise.popup('https://.../#/yonatan/intro')">Book</button>
 *   Slotwise.floating('https://.../#/yonatan/intro', { text: 'Book a call', color: '#E4572E' })
 * Events: window.addEventListener('message', e => e.data.source === 'slotwise' && e.data.type === 'booked')
 * Prefill: add ?name=&email= to the URL. Theme: &theme=dark
 */
(function () {
  if (window.Slotwise) return
  function withEmbed(url) {
    var parts = url.split('#')
    var hash = parts[1] || '/'
    hash += (hash.indexOf('?') >= 0 ? '&' : '?') + 'embed=1'
    return parts[0] + '#' + hash
  }
  function frame(url) {
    var f = document.createElement('iframe')
    f.src = withEmbed(url)
    f.title = 'Slotwise'
    f.style.cssText = 'width:100%;border:0;min-height:640px;color-scheme:normal;background:transparent'
    f.setAttribute('allow', 'payment')
    return f
  }
  window.addEventListener('message', function (e) {
    if (!e.data || e.data.source !== 'slotwise' || e.data.type !== 'height') return
    var frames = document.querySelectorAll('iframe')
    for (var i = 0; i < frames.length; i++) if (frames[i].contentWindow === e.source) frames[i].style.height = e.data.height + 'px'
  })
  function inline(el, url) {
    el.innerHTML = ''
    el.appendChild(frame(url || el.getAttribute('data-slotwise')))
  }
  function popup(url) {
    var o = document.createElement('div')
    o.style.cssText = 'position:fixed;inset:0;background:rgba(15,22,40,.5);z-index:2147483646;display:flex;align-items:center;justify-content:center;padding:16px'
    var box = document.createElement('div')
    box.style.cssText = 'background:#F6EFE1;border-radius:16px;width:min(1100px,100%);max-height:92vh;overflow:auto;position:relative'
    var x = document.createElement('button')
    x.textContent = '×'
    x.setAttribute('aria-label', 'Close')
    x.style.cssText = 'position:absolute;top:8px;right:12px;font-size:26px;border:0;background:none;cursor:pointer;z-index:1'
    x.onclick = function () { o.remove() }
    o.onclick = function (e) { if (e.target === o) o.remove() }
    box.appendChild(x)
    box.appendChild(frame(url))
    o.appendChild(box)
    document.body.appendChild(o)
  }
  function floating(url, opts) {
    opts = opts || {}
    var b = document.createElement('button')
    b.textContent = opts.text || 'Book a meeting'
    b.style.cssText = 'position:fixed;bottom:20px;right:20px;z-index:2147483645;border:0;border-radius:999px;padding:14px 22px;font:600 15px system-ui;cursor:pointer;box-shadow:0 10px 30px rgba(0,0,0,.2);color:#fff;background:' + (opts.color || '#E4572E')
    b.onclick = function () { popup(url) }
    document.body.appendChild(b)
  }
  window.Slotwise = { inline: inline, popup: popup, floating: floating }
  function boot() {
    var els = document.querySelectorAll('[data-slotwise]')
    for (var i = 0; i < els.length; i++) inline(els[i])
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot)
  else boot()
})()
