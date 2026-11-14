import test from 'node:test';
import assert from 'node:assert/strict';
import 'fake-indexeddb/auto';
import * as vault from '../public/offline.js';
import {encryptBackup,decryptBackup} from '../scripts/backup.js';

test('encrypted pending data survives module restart and rejects the wrong local passphrase',async()=>{
 const user={id:'test-offline-user',name:'Synthetic test user'};
 const data={user,site:'plant-1',state:{orders:[]},queue:[{operationId:'offline-operation',payload:{diagnosis:'Rodamiento desgastado'}}]};
 await vault.enableVault(user,'synthetic-test-passphrase-123',data);vault.lockVault();
 const reopened=await import('../public/storage.js?restart=1');await assert.rejects(()=>reopened.unlockVault(user.id,'wrong-test-passphrase'));const recovered=await reopened.unlockVault(user.id,'synthetic-test-passphrase-123');assert.deepEqual(recovered.queue,data.queue);
 const raw=await new Promise((resolve,reject)=>{const request=indexedDB.open('fast-up-encrypted-vault',1);request.onsuccess=()=>{const r=request.result.transaction('vaults').objectStore('vaults').get(user.id);r.onsuccess=()=>resolve(r.result);r.onerror=()=>reject(r.error);};});
 assert.ok(raw.data instanceof ArrayBuffer);assert.equal(new TextDecoder().decode(raw.data).includes('Rodamiento desgastado'),false);
 await reopened.removeVault(user.id);
});
test('concurrent local saves preserve the most recent acknowledged snapshot',async()=>{
 const user={id:'test-concurrent-vault',name:'Synthetic user'};await vault.enableVault(user,'synthetic-test-passphrase-456',{queue:[]});await Promise.all([vault.saveVault({queue:[1]}),vault.saveVault({queue:[1,2]}),vault.saveVault({queue:[1,2,3]})]);vault.lockVault();const data=await vault.unlockVault(user.id,'synthetic-test-passphrase-456');assert.deepEqual(data.queue,[1,2,3]);await vault.removeVault(user.id);
});
test('backup encryption authenticates contents and rejects corruption',()=>{
 const original={format:'fast-up-backup-v1',tables:{records:[]}},secret='synthetic-backup-passphrase';const encrypted=encryptBackup(original,secret);assert.deepEqual(decryptBackup(encrypted,secret),original);assert.throws(()=>decryptBackup(encrypted,'incorrect-passphrase'));const corrupted=JSON.parse(encrypted);corrupted.sha256='invalid';assert.throws(()=>decryptBackup(JSON.stringify(corrupted),secret));
});
test('an older tab cannot silently overwrite a newer encrypted outbox',async()=>{const user={id:'cross-tab-fixture',name:'Synthetic fixture'};await vault.enableVault(user,'cross-tab-test-passphrase',{queue:[]});const tab2=await import('../public/storage.js?tab=2');await tab2.unlockVault(user.id,'cross-tab-test-passphrase');await vault.saveVault({queue:['first-tab-record']});await assert.rejects(()=>tab2.saveVault({queue:['stale-second-tab']}),/otra pestaña/);vault.lockVault();assert.deepEqual((await vault.unlockVault(user.id,'cross-tab-test-passphrase')).queue,['first-tab-record']);await vault.removeVault(user.id);});
