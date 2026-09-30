const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const vm=require('node:vm');
function setup(){
 const elements=new Map();const context=new Proxy({createLinearGradient:()=>({addColorStop(){}})}, {get:(o,k)=>o[k]??(()=>{})});
 const get=id=>{if(!elements.has(id))elements.set(id,{value:id==='angle'?'45':id==='power'?'65':id==='weapon'?'shell':'',style:{},options:id==='weapon'?['shell','heavy','nuke'].map(value=>({value})):[],addEventListener(){},setAttribute(){},getContext:()=>context});return elements.get(id);};
 const sandbox={document:{getElementById:get,addEventListener(){}},Math,console,setTimeout:()=>1,clearTimeout(){},requestAnimationFrame(){}};vm.createContext(sandbox);vm.runInContext(fs.readFileSync('main.js','utf8'),sandbox);return {run:s=>vm.runInContext(s,sandbox),get};
}
test('shot resolves, damages a target, and cuts a crater',()=>{const {run}=setup();run('draw()');const before=run('ground(tanks[1].x)');run("blast(tanks[1].x,ground(tanks[1].x),'heavy')");assert.ok(run('tanks[1].hp')<100);assert.ok(run('ground(tanks[1].x)')>before);run('nextTurn()');assert.equal(run('turn'),1);});
test('AI fires a valid solution and a full flight finishes',()=>{const {run}=setup();run('nextTurn(); ai()');assert.equal(run('phase'),'flight');assert.ok(Number.isFinite(run('shot.vx')));run('for(let i=1;i<1500&&shot;i++)loop(i*16)');assert.equal(run('shot'),null);});
test('victory, defeat, and reset clear battle state',()=>{const {run,get}=setup();run('tanks.slice(1).forEach(t=>t.hp=0); nextTurn()');assert.equal(run('phase'),'over');assert.equal(get('overlay').hidden,false);run('reset();tanks[0].hp=0;nextTurn()');assert.equal(run('phase'),'over');run('reset()');assert.equal(run('turn'),0);assert.equal(run('phase'),'aim');assert.equal(run('tanks.every(t=>t.hp===100)'),true);assert.equal(get('overlay').hidden,true);});
test('limited ammunition is consumed and reset replenishes it',()=>{const {run,get}=setup();get('weapon').value='nuke';run('fire()');assert.equal(run('tanks[0].nuke'),0);assert.equal(run('shot.key'),'nuke');run('reset()');assert.equal(run('tanks[0].nuke'),1);});
