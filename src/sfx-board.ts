import { audio, type SfxName } from './audio/engine';

type Row = {
  label: string;
  name?: SfxName;
  bus?: 'sfx' | 'ui';
  file?: string;
  note?: string;
};

const groups: { title: string; rows: Row[] }[] = [
  {
    title: '',
    rows: [
      { label: 'Carta', name: 'paper', bus: 'ui', note: 'entra, si sposta, si posa, dossier' },
      { label: 'Attacco', name: 'whoosh', note: 'parte il colpo, e salti lo scontro' },
      { label: 'Colpo', name: 'punch', note: 'il danno di un attacco' },
      { label: 'Altro danno', name: 'boing', note: 'lo stesso colpo, più basso e più corto' },
      { label: 'KO', name: 'death', note: 'una figura muore' },
      { label: 'Lucky', name: 'bell', note: 'lucky, rianima e rewind' },
      { label: 'Trasformazione', name: 'puff', note: 'una figura cambia' },
      { label: 'Sticker', name: 'peel', bus: 'ui', note: 'attacchi, sostituisci o togli' },
      { label: 'Click', name: 'click', bus: 'ui', note: 'tocco secco, più basso della carta' },
    ],
  },
];

const list = document.getElementById('list')!;
let file: HTMLAudioElement | null = null;
let current: HTMLButtonElement | null = null;

for (const group of groups) {
  if (group.title) {
    const h = document.createElement('h2');
    h.textContent = group.title;
    list.appendChild(h);
  }
  for (const row of group.rows) {
    const button = document.createElement('button');
    button.type = 'button';
    button.innerHTML = `<span>${row.label}</span><small>${row.note ?? ''}</small>`;
    button.addEventListener('click', () => {
      void play(row, button);
    });
    list.appendChild(button);
  }
}

async function play(row: Row, button: HTMLButtonElement): Promise<void> {
  if (!audio.ctx) audio.ctx = new AudioContext();
  if (audio.ctx.state === 'suspended') await audio.ctx.resume();
  await audio.arm();
  audio.cutSfx();
  if (file) {
    file.pause();
    file = null;
  }
  current?.classList.remove('is-on');
  current = button;
  button.classList.add('is-on');
  if (row.file) {
    const el = new Audio(row.file);
    file = el;
    el.onended = () => {
      if (file === el) button.classList.remove('is-on');
    };
    await el.play();
    return;
  }
  if (row.name) audio.play(row.name, row.bus ?? 'sfx');
}
