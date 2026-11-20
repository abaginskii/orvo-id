// orvo — лист ожидания: появление, меню, эффекты прокрутки и подтверждение почты кодом.
(function () {
  var reduce = matchMedia('(prefers-reduced-motion: reduce)').matches;
  var $ = function (s, r) { return (r || document).querySelector(s); };
  var $$ = function (s, r) { return [].slice.call((r || document).querySelectorAll(s)); };

  // Появление шапки через 100 мс, первого экрана — через 300 мс.
  setTimeout(function () { document.body.classList.add('mounted'); }, 100);
  setTimeout(function () { document.body.classList.add('mounted-hero'); $('[data-hero-media]').classList.add('on'); }, 300);

  // Шапка темнеет после 40 px прокрутки.
  var nav = $('[data-nav]');
  function onScroll() { nav.classList.toggle('scrolled', scrollY > 40); }
  addEventListener('scroll', onScroll, { passive: true }); onScroll();

  // Меню на весь экран.
  var overlay = $('[data-overlay]'), label = $('[data-menu-label]'), open = false;
  function setMenu(v) {
    open = v;
    overlay.classList.toggle('open', v);
    overlay.setAttribute('aria-hidden', String(!v));
    label.textContent = v ? 'Закрыть' : 'Навигация';
    $$('[data-menu]').forEach(function (b) { b.setAttribute('aria-expanded', String(v)); });
    $('.burger').setAttribute('aria-label', v ? 'Закрыть меню' : 'Открыть меню');
    document.body.style.overflow = v ? 'hidden' : '';
  }
  $$('[data-menu]').forEach(function (b) { b.addEventListener('click', function () { setMenu(!open); }); });
  $$('a', overlay).forEach(function (a) { a.addEventListener('click', function () { setMenu(false); }); });
  addEventListener('keydown', function (e) { if (e.key === 'Escape' && open) setMenu(false); });

  // Манифест: слова загораются по мере прокрутки.
  var words = $('[data-words]');
  if (words) {
    words.innerHTML = words.textContent.split(/(\s+)/).map(function (w) { return /\S/.test(w) ? '<span class="w">' + w + '</span>' : w; }).join('');
    var ws = $$('.w', words);
    var paint = function () {
      var r = words.getBoundingClientRect(), vh = innerHeight;
      var p = Math.min(1, Math.max(0, (vh * 0.85 - r.top) / (r.height + vh * 0.35)));
      var n = Math.round(p * ws.length);
      ws.forEach(function (el, i) { el.classList.toggle('lit', i < n); });
    };
    if (reduce) ws.forEach(function (el) { el.classList.add('lit'); });
    else { addEventListener('scroll', paint, { passive: true }); paint(); }
  }

  // Главы: преимущества появляются, листы Полки раскрываются веером.
  if ('IntersectionObserver' in window) {
    var io = new IntersectionObserver(function (es) {
      es.forEach(function (e) {
        if (!e.isIntersecting) return;
        e.target.classList.add('in');
        var fan = $('[data-fan]', e.target); if (fan) setTimeout(function () { fan.classList.add('fanned'); }, 250);
        io.unobserve(e.target);
      });
    }, { threshold: 0.3 });
    $$('.chapter').forEach(function (c) { io.observe(c); });
  } else $$('.chapter').forEach(function (c) { c.classList.add('in'); });

  // Наклон карточек и свет за курсором.
  if (!reduce && matchMedia('(hover: hover)').matches) {
    $$('[data-tilt]').forEach(function (el) {
      el.addEventListener('pointermove', function (e) {
        var r = el.getBoundingClientRect(), x = (e.clientX - r.left) / r.width, y = (e.clientY - r.top) / r.height;
        el.style.setProperty('--ry', ((x - 0.5) * 8).toFixed(2) + 'deg');
        el.style.setProperty('--rx', ((0.5 - y) * 8).toFixed(2) + 'deg');
        el.style.setProperty('--gx', (x * 100 - 35).toFixed(1) + '%');
        el.style.setProperty('--gy', (y * 100 - 35).toFixed(1) + '%');
      });
      el.addEventListener('pointerleave', function () { ['--rx', '--ry', '--gx', '--gy'].forEach(function (k) { el.style.removeProperty(k); }); });
    });
  }

  // Сколько уже в листе — с подсчётом.
  function countUp(n) {
    var wrap = $('[data-count-wrap]'), el = $('[data-count]');
    if (!n) return; wrap.hidden = false;
    if (reduce) { el.textContent = n; return; }
    var t0 = performance.now();
    (function step(t) { var k = Math.min(1, (t - t0) / 1200); el.textContent = Math.round(n * (1 - Math.pow(1 - k, 3))); if (k < 1) requestAnimationFrame(step); })(t0);
  }
  fetch('/api/waitlist/count').then(function (r) { return r.json(); }).then(function (d) { countUp(d.count || 0); }).catch(function () {});

  // Почта → код → готово.
  var emailForm = $('[data-step="email"]'), codeForm = $('[data-step="code"]'), done = $('[data-step="done"]');
  var email = '', products = [];
  function show(step) {
    [emailForm, codeForm, done].forEach(function (el) { el.hidden = el.dataset.step !== step; });
    var f = $('input:not([type=checkbox])', step === 'email' ? emailForm : codeForm); if (f && step !== 'done') f.focus();
  }
  function post(path, body) {
    return fetch(path, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) })
      .then(function (r) { return r.json().catch(function () { return {}; }).then(function (d) { if (!r.ok) throw new Error(d.error || 'Нет связи с сервером. Попробуйте ещё раз.'); return d; }); });
  }
  function busy(form, on, text) { var b = $('button[type=submit]', form); b.disabled = on; if (text) b.textContent = text; }
  function fail(form, msg) { $('[data-error]', form).textContent = msg; }

  emailForm.addEventListener('submit', function (e) {
    e.preventDefault(); fail(emailForm, '');
    email = emailForm.email.value.trim().toLowerCase();
    products = $$('input[name=p]:checked', emailForm).map(function (i) { return i.value; });
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return fail(emailForm, 'Проверь адрес почты — в нём не хватает чего-то.');
    if (!products.length) return fail(emailForm, 'Выбери хотя бы одно приложение.');
    busy(emailForm, true, 'Отправляем…');
    post('/api/waitlist/start', { email: email }).then(function () {
      $('[data-email]').textContent = email; show('code');
    }).catch(function (err) { fail(emailForm, err.message); }).finally(function () { busy(emailForm, false, 'Получить код'); });
  });

  codeForm.code.addEventListener('input', function () {
    this.value = this.value.replace(/\D/g, '').slice(0, 6);
    if (this.value.length === 6) codeForm.requestSubmit();
  });
  codeForm.addEventListener('submit', function (e) {
    e.preventDefault(); fail(codeForm, '');
    var code = codeForm.code.value;
    if (code.length !== 6) return fail(codeForm, 'В коде шесть цифр.');
    busy(codeForm, true, 'Проверяем…');
    post('/api/waitlist/verify', { email: email, code: code, products: products }).then(function (d) {
      var names = (d.products || []).map(function (p) { return p === 'kite' ? 'Kite' : 'Полку'; }).join(' и ');
      $('[data-done-text]').textContent = (d.already ? 'Ты уже был в листе — обновили выбор. ' : '') + 'Напишем на ' + email + ', когда откроем ' + names + '. Ты ' + d.position + '-й в листе.';
      show('done'); countUp(d.position);
    }).catch(function (err) { fail(codeForm, err.message); codeForm.code.select(); }).finally(function () { busy(codeForm, false, 'Подтвердить'); });
  });
  $('[data-back]').addEventListener('click', function () { codeForm.code.value = ''; show('email'); });
})();
