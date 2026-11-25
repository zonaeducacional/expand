import { backup } from 'node:sqlite';
import { db, createInvite } from './store.js';

const [command, destination] = process.argv.slice(2);
if (command === 'invite' || command === 'admin-invite') {
  console.log(createInvite(destination ?? '', command === 'admin-invite').code);
} else if (command === 'promote' && destination) {
  const admin = db.prepare('SELECT id FROM members WHERE handle=?').get(destination);
  if (!admin) throw new Error('Arroba não encontrada.');
  db.prepare('INSERT OR IGNORE INTO administrators VALUES (?)').run(admin.id);
  console.log('Perfil promovido.');
} else if (command === 'backup' && destination) {
  await backup(db, destination);
} else {
  throw new Error('Uso: node admin.js invite | admin-invite | promote @arroba | backup ARQUIVO');
}
db.close();
