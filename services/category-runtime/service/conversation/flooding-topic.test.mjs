import test from 'node:test';
import assert from 'node:assert/strict';
import {fresh,episode} from './state.mjs';
import {interpretFlooding} from './flooding-interpret.mjs';
function parse(text){const s=fresh('49001','synthetic','test');episode(s);return interpretFlooding(s,text,'synthetic-topic-test')}
for(const text of ['Нужна помощь по страховому спору после залива квартиры','Нужна помощь по страховой выплате','Меня обвиняют в заливе. Как разобраться в причине протечки?']){
 test('cold help topic without context assertions: '+text,()=>{const p=parse(text);assert.equal(p.requestedStage,text.startsWith('Меня')?'accused_of_flooding':'insurance');assert.equal(p.facts.length,0)})
 for(const prefix of ['Если ','Квартира друга: ','В статье: ','Он, '])test('nonasserted topic remains unbound: '+prefix+text,()=>{const p=parse(prefix+text);assert.equal(p.requestedStage,null);assert.equal(p.facts.length,0)});
}
