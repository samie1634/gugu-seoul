import fs from 'node:fs';
import crypto from 'node:crypto';
import {makeMapLayout} from '../src/native/ported/map/layout.ts';
import {createMapNpcAdapter} from '../src/native/ported/npcs/runtime/map-adapter.ts';
const out = process.argv[2];
const runs=[];
for(let i=0;i<6;i++){
const start=performance.now(),layout=makeMapLayout({data:'osm'}),layoutEnd=performance.now(),adapter=createMapNpcAdapter(layout),end=performance.now();
const result={navNodes:layout.navNodes,navEdges:layout.navEdges,spawns:layout.spawns,routes:adapter.navigation.routes,spawnZones:adapter.navigation.spawnZones,excludedEdges:adapter.excludedEdges};
const hash=crypto.createHash('sha256').update(JSON.stringify(result)).digest('hex');
runs.push({layoutMs:layoutEnd-start,adapterMs:end-layoutEnd,totalMs:end-start,hash,edges:layout.navEdges.length,routes:adapter.navigation.routes.length,spawns:adapter.navigation.spawnZones.length});
}
const result={measuredAt:new Date().toISOString(),node:process.version,runs};
fs.writeFileSync(out,JSON.stringify(result,null,2));console.log(JSON.stringify(result,null,2));
