import { ReachBlockGoal } from './navigation.js';
import pathfinding from 'mineflayer-pathfinder';
import { Vec3 } from 'vec3';
import type { World } from './world.js';
import { IDS, type AgentId } from '../core/types.js';
const { goals } = pathfinding;
type Recipe = { out: number; ingredients: Record<string, number>; table?: boolean };
const recipes: Record<string, Recipe> = {
  oak_planks: { out: 4, ingredients: { oak_log: 1 } },
  stick: { out: 4, ingredients: { oak_planks: 2 } },
  crafting_table: { out: 1, ingredients: { oak_planks: 4 } },
  wooden_pickaxe: { out: 1, ingredients: { oak_planks: 3, stick: 2 }, table: true },
  stone_pickaxe: { out: 1, ingredients: { cobblestone: 3, stick: 2 }, table: true },
  stone_axe: { out: 1, ingredients: { cobblestone: 3, stick: 2 }, table: true },
  stone_shovel: { out: 1, ingredients: { cobblestone: 1, stick: 2 }, table: true },
  furnace: { out: 1, ingredients: { cobblestone: 8 }, table: true },
  shears: { out: 1, ingredients: { iron_ingot: 2 } },
  white_bed: { out: 1, ingredients: { white_wool: 3, oak_planks: 3 }, table: true },
  chest: { out: 1, ingredients: { oak_planks: 8 }, table: true },
  oak_door: { out: 3, ingredients: { oak_planks: 6 }, table: true },
  torch: { out: 4, ingredients: { coal: 1, stick: 1 } },
  stone_bricks: { out: 4, ingredients: { stone: 4 } },
  oak_stairs: { out: 4, ingredients: { oak_planks: 6 }, table: true },
  oak_slab: { out: 6, ingredients: { oak_planks: 3 }, table: true },
  ladder: { out: 3, ingredients: { stick: 7 }, table: true },
  glass_pane: { out: 16, ingredients: { glass: 6 }, table: true }
};
const raw: Record<string, string[]> = {
  oak_log: ['oak_log'], cobblestone: ['stone'], coal: ['coal_ore'],
  raw_iron: ['iron_ore'], sand: ['sand'], dirt: ['dirt','grass_block']
};
export class Survival {
  private targets = new Map<string, AgentId>();
  claimedByOther(id:AgentId,position:Vec3) { const owner=this.targets.get(position.toString());return owner!==undefined&&owner!==id; }
  readonly chestPosition = new Vec3(0, 64, 8);
  constructor(private world: World) {}
  private count(id: AgentId, name: string) { return this.world.inventory(id)[name] ?? 0; }
  private workPosition(id: AgentId, furnace = false) { return new Vec3((IDS.indexOf(id)-1)*5,64,furnace?9:10); }
  private activity(id: AgentId, text: string, detail?: object) { this.world.onActivity(id, text, detail); }
  async acquire(id: AgentId, name: string, count: number): Promise<void> {
    this.world.check();
    if (!Number.isInteger(count) || count < 1 || count > 256) throw new Error('Resource quantity must be 1..256');
    if (this.count(id,name) >= count) return;
    if (raw[name]) { await this.gather(id,name,count); return; }
    if (name === 'white_wool') { await this.wool(id,count); return; }
    const smeltInput: Record<string,string> = {glass:'sand',iron_ingot:'raw_iron',stone:'cobblestone'};
    if (smeltInput[name]) { await this.smelt(id,name,smeltInput[name],count); return; }
    const recipe=recipes[name];
    if (!recipe) throw new Error(`No survival recipe configured for ${name}`);
    if (recipe.table) await this.workbench(id);
    const bot=this.world.bot(id), item=bot.registry.itemsByName[name];
    let failures=0;
    while(this.count(id,name)<count) {
      this.world.check();
      // Acquiring a later ingredient can consume an earlier one (sticks use
      // planks), so verify the complete ingredient set before crafting.
      for(let pass=0;pass<3;pass++) {
        for(const [ingredient,amount] of Object.entries(recipe.ingredients)) await this.acquire(id,ingredient,amount);
        if(Object.entries(recipe.ingredients).every(([ingredient,amount])=>this.count(id,ingredient)>=amount))break;
      }
      const table=recipe.table?bot.blockAt(this.workPosition(id)):null;
      if(table) { try { await this.world.navigate(id,new ReachBlockGoal(table.position,bot.world,{reach:3})); } finally { bot.pathfinder.setGoal(null); } }
      const available=bot.recipesFor(item.id,null,1,table);
      if(!available.length)throw new Error(`Minecraft did not provide the ${name} recipe with the gathered ingredients`);
      this.activity(id,`Crafting ${name.replaceAll('_',' ')}`,{kind:'craft-start',name});
      this.world.check();const before=this.count(id,name);
      const click=bot.clickWindow.bind(bot);
      bot.clickWindow=async (...args:Parameters<typeof bot.clickWindow>)=>{
        await click(...args);
        await bot.waitForTicks(2);
        await (bot as typeof bot & {_syncWindow(window:typeof bot.inventory):Promise<void>})._syncWindow(bot.currentWindow??bot.inventory);
        await bot.waitForTicks(1);
      };
      try { await this.world.deadline(bot.craft(available[0],1,table??undefined)); }
      catch(error) { throw new Error(`Craft ${name} at ${bot.entity.position}, table ${table?.name}@${table?.position}: ${error}`); }
      finally { bot.clickWindow=click; }
      await bot.waitForTicks(3);
      // The pinned library only synchronizes a 3x3 window at the end. Request
      // authoritative slots for inventory crafting before the next operation.
      const inventoryBot=bot as typeof bot & {_syncWindow(window:typeof bot.inventory):Promise<void>};
      await this.world.deadline(inventoryBot._syncWindow(bot.inventory));
      await bot.waitForTicks(2);
      const produced=this.count(id,name)-before;
      if(produced<=0) { if(++failures>=3)throw new Error(`Crafting ${name} made no verified progress`); }
      else { failures=0;this.activity(id,`Crafted ${name}`,{kind:'crafted',name,count:produced}); }
    }
  }

  async workbench(id: AgentId) {
    const bot=this.world.bot(id),position=this.workPosition(id);
    if (bot.blockAt(position)?.name==='crafting_table') return;
    await this.acquire(id,'crafting_table',1);
    await this.world.place(id,{...position,name:'crafting_table'},true);
  }
  async gather(id: AgentId, name: string, count: number) {
    if (!raw[name]) throw new Error(`Cannot gather ${name} directly`);
    const bot=this.world.bot(id);
    if (['coal','raw_iron'].includes(name) && !bot.inventory.items().some(i=>i.name==='stone_pickaxe')) await this.acquire(id,'stone_pickaxe',1);
    if (name==='cobblestone' && !bot.inventory.items().some(i=>i.name.endsWith('_pickaxe'))) await this.acquire(id,'wooden_pickaxe',1);
    let attempts=0;
    const skipped=new Set<string>();
    while (this.count(id,name)<count) {
      this.world.check();
      if (++attempts>count*3+12) throw new Error(`No further progress gathering ${name}`);
      const positions=bot.findBlocks({matching:raw[name].map(n=>bot.registry.blocksByName[n].id),useExtraInfo:block=>{
        const p=block.position;
        return Math.abs(p.x)<=14 && Math.abs(p.z)<=14 && p.y>=60 && p.y<=74 && !(Math.abs(p.x)<=6&&Math.abs(p.z)<=6)
          && [[1,0,0],[-1,0,0],[0,1,0],[0,-1,0],[0,0,1],[0,0,-1]].some(([dx,dy,dz])=>bot.blockAt(p.offset(dx,dy,dz))?.name==='air');
      },maxDistance:48,count:512});
      const centers=[new Vec3(-11,64,0),new Vec3(0,64,-11),new Vec3(5,64,13)];
      const center=name==='oak_log'?centers[IDS.indexOf(id)]:bot.entity.position;
      const candidates=positions.filter(p=>Math.abs(p.x)<=14 && Math.abs(p.z)<=14 && p.y>=60 && p.y<=74 && !(Math.abs(p.x)<=6&&Math.abs(p.z)<=6) && !this.targets.has(p.toString()) && !skipped.has(p.toString()) && [[1,0,0],[-1,0,0],[0,1,0],[0,-1,0],[0,0,1],[0,0,-1]].some(([dx,dy,dz])=>bot.blockAt(p.offset(dx,dy,dz))?.name==='air'))
        .sort((a,b)=>a.distanceTo(center)-b.distanceTo(center)+Math.max(0,a.y-64)*3-Math.max(0,b.y-64)*3);
      const target=candidates[0];
      if (!target) throw new Error(`No unclaimed ${name} resources remain within the biome`);
      this.targets.set(target.toString(),id);
      try {
        this.activity(id,`Gathering ${name.replaceAll('_',' ')} · ${this.count(id,name)}/${count}`,{kind:'gather',name,target});
        await this.world.navigate(id,new ReachBlockGoal(target,bot.world,{reach:3.5}));
        this.world.check();
        const block=bot.blockAt(target);
        if (!block || !raw[name].includes(block.name)) continue;
        const suffix=['coal','raw_iron','cobblestone'].includes(name)?'_pickaxe':name==='oak_log'?'_axe':'_shovel';
        const tool=bot.inventory.items().find(i=>i.name==='stone'+suffix)??bot.inventory.items().find(i=>i.name.endsWith(suffix));
        if (tool) await bot.equip(tool,'hand');
        const before=this.count(id,name);
        this.world.check();
        await this.world.deadline(bot.dig(block),15000);
        await bot.waitForTicks(15);
        await this.pickup(id,name,target);
        if (this.count(id,name)<=before) skipped.add(target.toString());
        else this.activity(id,`Gathered ${name.replaceAll('_',' ')}`,{kind:'gathered',name,count:this.count(id,name)-before});
      } catch(error) {
        this.world.check(); skipped.add(target.toString());
        if (skipped.size>=8) throw error;
      } finally { bot.pathfinder.setGoal(null); this.targets.delete(target.toString()); }
    }
  }
  private async pickup(id: AgentId,name: string,near: Vec3) {
    const bot=this.world.bot(id);
    for (let attempt=0;attempt<3;attempt++) {
      this.world.check();
      const drops=Object.values(bot.entities).filter(e=>e.name==='item' && e.position.distanceTo(near)<8 && e.getDroppedItem()?.name===name).sort((a,b)=>a.position.distanceTo(bot.entity.position)-b.position.distanceTo(bot.entity.position));
      if (!drops.length) { await bot.waitForTicks(5); continue; }
      const position=drops[0].position.floored();
      try { await this.world.navigate(id,new goals.GoalBlock(position.x,position.y,position.z),10000); }
      finally { bot.pathfinder.setGoal(null); }
      await bot.waitForTicks(8);
    }
  }
  private async smelt(id: AgentId,name: string,input: string,count: number) {
    const bot=this.world.bot(id),position=this.workPosition(id,true);
    await this.workbench(id);
    if (bot.blockAt(position)?.name!=='furnace') { await this.acquire(id,'furnace',1); await this.world.place(id,{...position,name:'furnace'},true); }
    const missing=count-this.count(id,name);
    await this.acquire(id,input,missing);
    await this.acquire(id,'coal',Math.ceil(missing/8));
    try { await this.world.navigate(id,new ReachBlockGoal(position,bot.world,{reach:3})); } finally { bot.pathfinder.setGoal(null); }
    const furnace=await this.world.deadline(bot.openFurnace(bot.blockAt(position)!));
    try {
      const output=furnace.outputItem();
      if(output) { if(output.name!==name) throw new Error('Private furnace has a different unfinished output'); await furnace.takeOutput(); }
      if(this.count(id,name)>=count) return;
      if(furnace.inputItem() && furnace.inputItem()!.name!==input) throw new Error('Private furnace has different unfinished input');
      this.world.check();
      const needed=count-this.count(id,name)-(furnace.inputItem()?.count??0);
      if(needed>0) await furnace.putInput(bot.registry.itemsByName[input].id,null,needed);
      if(!furnace.fuelItem()) await furnace.putFuel(bot.registry.itemsByName.coal.id,null,Math.ceil((count-this.count(id,name))/8));
      const expires=Date.now()+(count-this.count(id,name))*12000+20000;
      while(this.count(id,name)<count) {
        this.world.check();
        this.activity(id,`Smelting ${name} · ${this.count(id,name)}/${count}`,{kind:'smelt',name});
        if(furnace.outputItem()) { const amount=furnace.outputItem()!.count;await furnace.takeOutput();this.activity(id,`Smelted ${name}`,{kind:'crafted',name,count:amount}); }
        if(Date.now()>expires) throw new Error(`Furnace timed out smelting ${name}`);
        await bot.waitForTicks(20);
      }
    } finally { furnace.close(); await bot.waitForTicks(3); }
  }
  private async wool(id: AgentId,count: number) {
    await this.acquire(id,'shears',1);
    const bot=this.world.bot(id), tried=new Set<number>();
    for(let attempt=0;this.count(id,'white_wool')<count && attempt<18;attempt++) {
      this.world.check();
      const sheep=Object.values(bot.entities).filter(e=>e.name==='sheep'&&!tried.has(e.id)&&!this.targets.has(`sheep:${e.id}`)).sort((a,b)=>a.position.distanceTo(bot.entity.position)-b.position.distanceTo(bot.entity.position))[0];
      if(!sheep) throw new Error('No unclaimed unsheared sheep found; wait for grass regrowth');
      this.targets.set(`sheep:${sheep.id}`,id);tried.add(sheep.id);
      try {
        await this.world.navigate(id,new goals.GoalFollow(sheep,2),15000);bot.pathfinder.setGoal(null);
        this.world.check();await bot.equip(bot.inventory.items().find(i=>i.name==='shears')!,'hand');
        this.activity(id,'Shearing a sheep',{kind:'shear',entity:sheep.id});
        this.world.check();const before=this.count(id,'white_wool');
        await bot.activateEntity(sheep);await bot.waitForTicks(15);await this.pickup(id,'white_wool',sheep.position);
        this.activity(id,'Collected sheep wool',{kind:'gathered',name:'white_wool',count:this.count(id,'white_wool')-before});
      }finally{bot.pathfinder.setGoal(null);this.targets.delete(`sheep:${sheep.id}`);}
    }
    if(this.count(id,'white_wool')<count) throw new Error('Not enough wool collected');
  }
  async ensureStorage(id: AgentId) { return this.world.chests.run(()=>this.sharedChest(id)); }
  private async sharedChest(id: AgentId) {
    const bot=this.world.bot(id);
    if(bot.blockAt(this.chestPosition)?.name==='chest') return;
    await this.acquire(id,'chest',1);
    await this.world.place(id,{...this.chestPosition,name:'chest'},true);
  }
  async transfer(id: AgentId,name: string,count: number,deposit=false,receipt?:{before(stock:number,inventory:number):void;after():void}) {
    return this.world.chests.run(async()=>{
      this.world.check();
      if(!Number.isInteger(count)||count<1||count>256)throw new Error('Invalid transfer count');
      await this.sharedChest(id);
      const bot=this.world.bot(id), item=bot.registry.itemsByName[name];
      if(!item)throw new Error('Unknown transfer item');
      const approaches=[new Vec3(0,64,7),new Vec3(-1,64,8),new Vec3(1,64,8),new Vec3(-1,64,7),new Vec3(1,64,7)].filter(p=>
        bot.blockAt(p)?.name==='air' && bot.blockAt(p.offset(0,1,0))?.name==='air' && bot.blockAt(p.offset(0,-1,0))?.boundingBox==='block');
      await this.world.moveToAny(id,approaches);
      const chest=await this.world.deadline(bot.openContainer(bot.blockAt(this.chestPosition)!));
      try {
        this.world.check();
        const stock=()=>chest.containerItems().filter(i=>i.name===name).reduce((sum,i)=>sum+i.count,0);
        const beforeStock=stock();receipt?.before(beforeStock,this.count(id,name));
        if(deposit) await this.world.deadline(chest.deposit(item.id,null,count));
        else await this.world.deadline(chest.withdraw(item.id,null,count));
        await this.world.deadline((bot as typeof bot & {_syncWindow(window:typeof chest):Promise<void>})._syncWindow(chest));
        await bot.waitForTicks(3);
        if(stock()!==beforeStock+(deposit?count:-count))throw new Error(`Shared storage transfer could not be verified: ${id} ${deposit?'deposit':'withdraw'} ${count} ${name}, stock ${beforeStock} -> ${stock()}, inventory ${this.count(id,name)}`);
        receipt?.after();
        this.activity(id,`${deposit?'Deposited':'Withdrew'} ${count} ${name}`,{kind:deposit?'deposit':'withdraw',name,count});
      }finally{chest.close();await bot.waitForTicks(5);}
      return {transferred:count};
    });
  }
}
