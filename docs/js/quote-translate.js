document.addEventListener('DOMContentLoaded', function () {
  document.querySelectorAll('blockquote[data-cn]').forEach(function (el) {
    const cn = el.getAttribute('data-cn');
    const tip = document.createElement('div');
    tip.className = 'quote-cn';
    tip.textContent = cn;
    el.appendChild(tip);

    el.addEventListener('mouseenter', () => tip.classList.add('show'));
    el.addEventListener('mouseleave', () => tip.classList.remove('show'));
    el.addEventListener('click', () => tip.classList.toggle('show'));
  });
});
