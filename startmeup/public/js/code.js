function copyCode(btn) {
  const codeBlock = btn.nextElementSibling.textContent;
  navigator.clipboard.writeText(codeBlock).then(() => {
    btn.textContent = 'Copied!';
    btn.classList.add('copied');
    setTimeout(() => {
      btn.textContent = 'Copy';
      btn.classList.remove('copied');
    }, 2000);
  });
}