(function () {
  // Mobile menu
  var menu = document.getElementById('mobile-menu');
  var openBtn = document.querySelector('[data-menu-open]');
  function setMenu(open) {
    menu.classList.toggle('is-open', open);
    menu.setAttribute('aria-hidden', String(!open));
    if (open) menu.removeAttribute('inert'); else menu.setAttribute('inert', '');
    openBtn.setAttribute('aria-expanded', String(open));
    document.body.style.overflow = open ? 'hidden' : '';
  }
  openBtn.addEventListener('click', function () { setMenu(true); });
  document.querySelectorAll('[data-menu-close]').forEach(function (el) {
    el.addEventListener('click', function () { setMenu(false); });
  });
  menu.querySelectorAll('a').forEach(function (a) { a.addEventListener('click', function () { setMenu(false); }); });
  window.addEventListener('keydown', function (e) { if (e.key === 'Escape') setMenu(false); });

  // Scroll to #hash on load (e.g. index.html#home)
  function scrollToHash() {
    if (!location.hash) return;
    var el = document.getElementById(location.hash.slice(1));
    if (el) el.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }
  window.addEventListener('load', scrollToHash);
  window.addEventListener('hashchange', scrollToHash);

  // Draggable auto-scrolling marquees (contact ticker, testimonials)
  var reduce = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  document.querySelectorAll('[data-marquee]').forEach(function (viewport) {
    var track = viewport.querySelector('[data-track]');
    var set = viewport.querySelector('[data-set]');
    var speed = parseFloat(viewport.getAttribute('data-marquee')) || 80;
    var offset = 0, width = 0, last = null, dragging = false, startX = 0, startOffset = 0;
    function apply() { track.style.transform = 'translate3d(' + offset + 'px,0,0)'; }
    function measure() { width = set.getBoundingClientRect().width; }
    measure();
    if (window.ResizeObserver) { var ro = new ResizeObserver(measure); ro.observe(set); ro.observe(viewport); }
    if (!reduce) {
      (function tick(ts) {
        requestAnimationFrame(tick);
        if (dragging) { last = ts; return; }
        var dt = Math.min(0.05, ((ts - (last == null ? ts : last)) / 1000));
        last = ts;
        if (!width) return;
        offset -= speed * dt;
        if (offset <= -width) offset += width;
        apply();
      })(performance.now());
    }
    viewport.addEventListener('pointerdown', function (e) {
      dragging = true; viewport.classList.add('is-dragging');
      startX = e.clientX; startOffset = offset;
      if (viewport.setPointerCapture) viewport.setPointerCapture(e.pointerId);
    });
    viewport.addEventListener('pointermove', function (e) {
      if (!dragging) return;
      offset = startOffset + (e.clientX - startX);
      if (width) { while (offset <= -width) offset += width; while (offset > 0) offset -= width; }
      apply();
    });
    function end(e) {
      if (!dragging) return;
      dragging = false; viewport.classList.remove('is-dragging');
      if (viewport.releasePointerCapture) viewport.releasePointerCapture(e.pointerId);
    }
    viewport.addEventListener('pointerup', end);
    viewport.addEventListener('pointercancel', end);
  });

  // Contact form: posts to send-mail.php, which emails the enquiry
  var form = document.querySelector('[data-contact-form]');
  if (form) form.addEventListener('submit', function (e) {
    e.preventDefault();
    var btn = form.querySelector('.contact-submit');
    var status = form.querySelector('[data-form-status]');
    function show(msg, ok) {
      status.textContent = msg;
      status.style.color = ok ? '#2e7d32' : '#c62828';
    }
    btn.disabled = true;
    show('Sending...', true);
    fetch('send-mail.php', { method: 'POST', body: new FormData(form) })
      .then(function (r) { return r.json(); })
      .then(function (d) {
        if (d.ok) { form.reset(); show('Thank you! Your message has been sent.', true); }
        else show(d.error || 'Something went wrong. Please try again.', false);
      })
      .catch(function () { show('Could not send your message. Please email us directly.', false); })
      .then(function () { btn.disabled = false; });
  });
})();
