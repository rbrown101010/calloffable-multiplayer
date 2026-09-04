import { createHash, createHmac, randomUUID, timingSafeEqual } from 'node:crypto';
import { init } from '@instantdb/admin';
const digest = value => createHash('sha256').update(String(value || '')).digest();
const equal = (a,b) => !!a && !!b && timingSafeEqual(digest(a),digest(b));
export default async function handler(req,res) {
  res.setHeader('Cache-Control','no-store');
  if(req.method !== 'POST')return res.status(405).json({error:'Use POST.'});
  const { INSTANT_APP_ID, INSTANT_APP_ADMIN_TOKEN, LOBBY_INVITE_KEY, LOBBY_HOST_KEY }=process.env;
  if(!INSTANT_APP_ADMIN_TOKEN||!LOBBY_INVITE_KEY||!LOBBY_HOST_KEY)return res.status(503).json({error:'The private lobby is being configured. Solo play is available.'});
  let body;try{body=typeof req.body==='string'?JSON.parse(req.body):req.body||{};}catch{return res.status(400).json({error:'Invalid request.'});}
  const owner=equal(body.key,LOBBY_HOST_KEY);
  if(!owner&&!equal(body.key,LOBBY_INVITE_KEY))return res.status(403).json({error:'This lobby is invite only. Open your invite link or paste the invitation code.'});
  const name=String(body.name||'OPERATOR').replace(/[^a-zA-Z0-9 _-]/g,'').trim().slice(0,16)||'OPERATOR';
  try {
    const db=init({appId:INSTANT_APP_ID||'ec099d8e-0cbc-4742-87f6-e01fac862c5c',adminToken:INSTANT_APP_ADMIN_TOKEN});
    let userId=randomUUID(),token;
    if(body.token){try{const u=await db.auth.verifyToken(body.token);userId=u.id;token=body.token;}catch{}}
    token ||= await db.auth.createToken({id:userId});
    const roomId=createHmac('sha256',LOBBY_HOST_KEY).update('sable-reach-one-lobby-v1').digest('hex');
    const iceServers=[{urls:['stun:stun.l.google.com:19302','stun:stun.cloudflare.com:3478']}];
    // An optional private TURN service supplements STUN; blocked peers use the room radio fallback.
    const ice=process.env.TURN_ICE_SERVERS?JSON.parse(process.env.TURN_ICE_SERVERS):iceServers;
    return res.status(200).json({id:userId,name,token,roomId,owner,inviteKey:owner?LOBBY_INVITE_KEY:undefined,iceServers:ice});
  } catch(e){console.error('Lobby join failed:',e.message);return res.status(503).json({error:'The lobby service is temporarily unavailable. Please try again.'});}
}
