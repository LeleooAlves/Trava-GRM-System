document.addEventListener('DOMContentLoaded', () => {
  const btnTrava = document.getElementById('btn-trava');
  const btnRelevancia = document.getElementById('btn-relevancia');
  const frameTrava = document.getElementById('frame-trava');
  const frameRelevancia = document.getElementById('frame-relevancia');

  btnTrava.addEventListener('click', () => {
    btnTrava.classList.remove('inactive');
    btnRelevancia.classList.add('inactive');
    frameTrava.classList.remove('hidden');
    frameRelevancia.classList.add('hidden');
  });

  btnRelevancia.addEventListener('click', () => {
    btnRelevancia.classList.remove('inactive');
    btnTrava.classList.add('inactive');
    frameRelevancia.classList.remove('hidden');
    frameTrava.classList.add('hidden');
  });
});
