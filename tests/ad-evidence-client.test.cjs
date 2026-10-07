const { test, before } = require('node:test');
const assert = require('node:assert/strict');
const { pathToFileURL } = require('node:url');
const path = require('node:path');
let evidence;
before(async () => { evidence = await import(pathToFileURL(path.join(__dirname, '../client/src/data/adEvidence.js')).href); });

test('paid evidence survives unconfirmed team state and masked costs', () => {
    for (const row of [{ad_spend:14.05}, {ad_spend:null,ad_has_spend:true}, {ad_spend:null,ad_done_from_spend:true}]) {
        assert.equal(evidence.adEvidence(row,false,false).kind,'paid');
        assert.equal(evidence.adEvidence(row,true,true).kind,'paid');
    }
});
test('confirmation without spend is attributed to the team or PFM, not paid delivery', () => {
    assert.equal(evidence.adEvidence({ad_has_spend:false},true,false).label,'ทีมยืนยันว่าเริ่มยิงแล้ว');
    assert.equal(evidence.adEvidence({ad_has_spend:false},true,true).label,'PFM แจ้งว่าเริ่มยิงแล้ว');
    assert.equal(evidence.adEvidence({},false,true).kind,'pending');
});
test('no-ad classification never hides historical spend evidence', () => {
    assert.equal(evidence.adEvidence({ad_spend:0},false,false,true).label,'ไม่ต้องยิงแอด');
    assert.equal(evidence.adEvidence({ad_spend:50},false,false,true).kind,'paid');
});
