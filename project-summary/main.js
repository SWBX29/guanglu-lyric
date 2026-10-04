// 光路·歌词 — 进入动画 + 导航高亮
(() => {
  const io = new IntersectionObserver((entries) => {
    for (const e of entries) {
      if (e.isIntersecting) {
        e.target.classList.add('in');
        io.unobserve(e.target);
      }
    }
  }, { threshold: 0.12, rootMargin: '0px 0px -40px 0px' });

  document.querySelectorAll('.reveal').forEach(el => io.observe(el));

  // 平滑滚动（兼容降级：CSS scroll-behavior 已设置，这里补 offset）
  document.querySelectorAll('.nav-links a').forEach(a => {
    a.addEventListener('click', (ev) => {
      const id = a.getAttribute('href');
      const target = document.querySelector(id);
      if (!target) return;
      ev.preventDefault();
      const y = target.getBoundingClientRect().top + window.scrollY - 70;
      window.scrollTo({ top: y, behavior: 'smooth' });
    });
  });
})();
