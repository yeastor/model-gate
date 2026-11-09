import test from 'node:test';
import assert from 'node:assert/strict';
import {neighborsSearchStageHint} from './neighbors-qdrant.mjs';

test('literal music topic narrows search without interpreting time or violations',()=>{
  assert.equal(neighborsSearchStageHint('шумят саседи музыка ночю квартира рядом'),'noise');
  assert.equal(neighborsSearchStageHint('Из соседней квартиры регулярно доносится громкая музыка.'),'noise');
  assert.equal(neighborsSearchStageHint('Мне мешают дома, не знаю откуда это.'),null);
  assert.equal(neighborsSearchStageHint('Управляющая компания не отвечает'),null);
});
test('mixed music with animal or construction topic stays unforced',()=>{
  for(const text of ['У соседа музыка, но мешает лай собаки','Ремонт и музыка','Музыка или животное','Сосед сверлит, ещё слышна музыка'])
    assert.equal(neighborsSearchStageHint(text),null);
});
