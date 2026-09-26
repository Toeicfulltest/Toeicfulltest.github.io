import assert from 'node:assert/strict';
import {autoFill,candidateBatch,itemQuestionCount,selectionProblems} from '../assets/question-bank/bank-generator-data.js';

const mk=(id,part,q,difficulty='medium')=>({id,part_no:part,item_type:[3,4,6,7].includes(part)?'G':'Q',q_count:q,difficulty,stats:{usage_count:0,last_used_at:null},tags:[],topics:[]});

const p7=[mk('a',7,5),mk('b',7,4),mk('c',7,3),mk('d',7,2)];
const suggestions=candidateBatch(p7,{part:7,remaining:10,selected:[],targets:{7:10},prefs:{},limit:10});
assert.ok(!suggestions.some(x=>x.id==='b'),'P7 candidate that leaves impossible remainder must be filtered');

for(let i=0;i<30;i++){
  const result=autoFill(p7,[7],{7:10},{},[],new Set());
  assert.deepEqual(selectionProblems([7],{7:10},result.selected),[],`P7 exact combination failed on run ${i+1}`);
  assert.equal(result.selected.reduce((n,x)=>n+itemQuestionCount(x.item),0),10);
}

const locked={item:mk('locked',6,4),locked:true};
const p6=[locked.item,mk('e',6,4),mk('f',6,4),mk('g',6,4),mk('h',6,4)];
const withLock=autoFill(p6,[6],{6:16},{},[locked],new Set());
assert.ok(withLock.selected.some(x=>x.item.id==='locked'&&x.locked),'locked bank group must survive reroll');
assert.equal(withLock.selected.reduce((n,x)=>n+itemQuestionCount(x.item),0),16);

const p5=Array.from({length:30},(_,i)=>mk(`q${i+1}`,5,1));
const reading=autoFill(p5,[5],{5:30},{balanceDifficulty:true,preferLowUse:true},[],new Set());
assert.equal(reading.selected.length,30,'Part 5 should draw exactly 30 standalone questions');

console.log('Question-bank generator smoke OK: exact group combinations, locks, and Part 5 count.');
