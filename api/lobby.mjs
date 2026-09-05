import { createHash, createHmac, randomBytes, randomUUID, timingSafeEqual } from 'node:crypto';
import { init } from '@instantdb/admin';
const digest=value=>createHash('sha256').update(String(value||'')).digest();
const equal=(a,b)=>!!a&&!!b&&timingSafeEqual(digest(a),digest(b));
const uuid=value=>{const h=digest(value).toString('hex');return `${h.slice(0,8)}-${h.slice(8,12)}-4${h.slice(13,16)}-a${h.slice(17,20)}-${h.slice(20,32)}`;};
const sign=(value,secret)=>createHmac('sha256',secret).update(value).digest('base64url');
const localAttempts=new Map();
export default async function handler(req,res){
  res.setHeader('Cache-Control','no-store');
  if(req.method!=='POST')return res.status(405).json({error:'Use POST.'});
  const {INSTANT_APP_ID,INSTANT_APP_ADMIN_TOKEN,LOBBY_HOST_KEY,LOBBY_HOST_PIN}=process.env;
  if(!INSTANT_APP_ADMIN_TOKEN||!LOBBY_HOST_KEY||!/^\d{6}$/.test(LOBBY_HOST_PIN||''))return res.status(503).json({error:'The private lobby is being configured. Solo play is available.'});
  let body;try{body=typeof req.body==='string'?JSON.parse(req.body):req.body||{};}catch{return res.status(400).json({error:'Invalid request.'});}
  const action=body.action||'join';
  if(!['create','join','status','start','end'].includes(action))return res.status(400).json({error:'Unknown lobby action.'});
  const db=init({appId:INSTANT_APP_ID||'ec099d8e-0cbc-4742-87f6-e01fac862c5c',adminToken:INSTANT_APP_ADMIN_TOKEN});
  const controlId=uuid(LOBBY_HOST_KEY+'owner-lobby-control-v1');
  const read=async()=> (await db.query({lobbyControl:{$:{where:{id:controlId}}}})).lobbyControl?.[0];
  try{
    if(action==='create'){
      // Persist failed PIN attempts across function instances; never store the PIN or IP.
      const ip=String(req.headers?.['x-vercel-forwarded-for']||req.headers?.['x-forwarded-for']||req.socket?.remoteAddress||'unknown').split(',')[0];
      const bucket=Math.floor(Date.now()/900000),attemptId=uuid(LOBBY_HOST_KEY+ip+bucket);
      const row=(await db.query({lobbyPinAttempts:{$:{where:{id:attemptId}}}})).lobbyPinAttempts?.[0];
      const count=Math.max(row?.attempts||0,localAttempts.get(attemptId)||0);
      if(count>=8){res.setHeader('Retry-After','900');return res.status(429).json({error:'Too many incorrect host codes. Try again in 15 minutes.'});}
      if(!equal(String(body.key||''),LOBBY_HOST_PIN)){
        localAttempts.set(attemptId,count+1);if(localAttempts.size>10000)localAttempts.clear();
        await db.transact(db.tx.lobbyPinAttempts[attemptId].update({attempts:count+1,expiresAt:(bucket+1)*900000}));
        return res.status(403).json({error:'Incorrect host code. Friends should use Join a lobby and their invitation.'});
      }
    }
    let current=await read();
    if(action==='status'||action==='start'||action==='end'){
      const [payload,mac]=String(body.access||'').split('.');
      let access;try{if(!equal(mac,sign(payload||'',LOBBY_HOST_KEY)))throw 0;access=JSON.parse(Buffer.from(payload,'base64url').toString());}catch{return res.status(403).json({error:'Your lobby access expired. Join again.'});}
      if(!access.id||access.expiresAt<Date.now()||!current?.active||current.roomId!==access.roomId)return res.status(410).json({error:'This lobby has ended. Ask the owner for the new invitation.'});
      if(action!=='status'&&(!access.owner||access.id!==current.ownerId))return res.status(403).json({error:'Only the owner can create, start, or end games.'});
      if(action==='end'){await db.transact(db.tx.lobbyControl[controlId].update({active:false}));return res.status(200).json({ended:true});}
      if(action==='start')return res.status(200).json({round:randomUUID()});
      // Use authenticated transport identities, never client-declared owner flags or IDs.
      const presence=await db.rooms.getPresence('sable',current.roomId+'-match-v5');
      const members=Object.values(presence).filter(p=>p?.user?.id&&p?.['peer-id']).map(p=>({peerId:p['peer-id'],id:p.user.id}));
      return res.status(200).json({ownerId:current.ownerId,members});
    }
    if(action==='join'&&(!current?.active||!equal(String(body.key||''),current.inviteKey)))return res.status(403).json({error:'That invitation is no longer active. Ask the owner for the new lobby link.'});
    const name=String(body.name||'').replace(/[^a-zA-Z0-9 _-]/g,'').trim().slice(0,16);
    if(!name)return res.status(400).json({error:'Enter your callsign first.'});
    let userId=randomUUID(),token;
    if(body.token){try{const user=await db.auth.verifyToken(body.token);userId=user.id;token=body.token;}catch{}}
    token ||= await db.auth.createToken({id:userId});
    if(action==='create'){
      // A retried create request returns the same lobby instead of resetting it twice.
      if(!body.requestId||body.requestId!==current?.requestId||current.ownerId!==userId||!current.active){
        current={roomId:randomUUID(),ownerId:userId,inviteKey:randomBytes(18).toString('base64url'),active:true,requestId:String(body.requestId||randomUUID()),createdAt:Date.now()};
        await db.transact(db.tx.lobbyControl[controlId].update(current));
      }
    }
    const owner=action==='create'||current.ownerId===userId;
    const payload=Buffer.from(JSON.stringify({id:userId,roomId:current.roomId,owner,expiresAt:Date.now()+86400000})).toString('base64url');
    const iceServers=process.env.TURN_ICE_SERVERS?JSON.parse(process.env.TURN_ICE_SERVERS):[{urls:['stun:stun.l.google.com:19302','stun:stun.cloudflare.com:3478']}];
    return res.status(200).json({id:userId,name,token,roomId:current.roomId,owner,ownerId:current.ownerId,inviteKey:current.inviteKey,access:payload+'.'+sign(payload,LOBBY_HOST_KEY),iceServers});
  }catch(e){console.error('Lobby request failed:',e.message);return res.status(503).json({error:'The lobby service is temporarily unavailable. Please try again.'});}
}
