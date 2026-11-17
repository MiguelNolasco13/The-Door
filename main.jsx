import React,{useEffect,useMemo,useRef,useState} from "react";
import {createRoot} from "react-dom/client";
import { onAuthStateChanged, signInWithPopup, GoogleAuthProvider, signInWithEmailAndPassword, createUserWithEmailAndPassword, signOut } from "firebase/auth";
import { doc, getDoc, onSnapshot, setDoc, serverTimestamp, collection, getDocs, addDoc, updateDoc, deleteDoc, query, orderBy, limit } from "firebase/firestore";
import { auth, db } from "./firebase.js";
import QRCode from "qrcode";
import {Html5Qrcode,Html5QrcodeSupportedFormats} from "html5-qrcode";
import {PackagePlus,ScanLine,Users,History,Truck,MapPin,Trash2,Send,Search,Home,LogOut,Plus,CheckCircle2,Clock,ChevronRight,Pencil,UserPlus,MessageSquare,Building2,ShieldCheck,Wallet,CalendarDays,RefreshCw,Mail,Menu,X} from "lucide-react";
import "./styles.css";
import brandIcon from "./the-door-icon.png";

const initial={residents:[],couriers:[],orders:[],correspondences:[]};
// Fotos ficam locais nesta primeira etapa: Firestore não é armazenamento de imagens e cada documento tem limite de 1 MiB.
function stripPhotos(value){return {residents:value.residents||[],couriers:value.couriers||[],orders:(value.orders||[]).map(({photo,...order})=>order),correspondences:(value.correspondences||[]).map(({photo,...correspondence})=>correspondence)};}
function mergeLocalPhotos(cloud,current){const orderPhotos=new Map((current.orders||[]).filter(o=>o.photo).map(o=>[o.id,o.photo]));const correspondencePhotos=new Map((current.correspondences||[]).filter(c=>c.photo).map(c=>[c.id,c.photo]));return {...cloud,orders:(cloud.orders||[]).map(o=>orderPhotos.has(o.id)?{...o,photo:orderPhotos.get(o.id)}:o),correspondences:(cloud.correspondences||[]).map(c=>correspondencePhotos.has(c.id)?{...c,photo:correspondencePhotos.get(c.id)}:c)};}

function uid(p="id"){return p+"-"+Date.now()+"-"+Math.random().toString(36).slice(2,7)}
function normalizeEmail(email){return String(email||"").trim().toLowerCase()}
// Integração preparada para leitura inteligente de etiquetas.
// O endpoint deve receber { image: "data:image/..." } e retornar JSON com, por exemplo:
// { tracking, carrier, recipientName, confidence }. A chave de API fica no servidor, nunca no navegador.
const AI_LABEL_ENDPOINT=import.meta.env.VITE_AI_LABEL_ENDPOINT||"";
let tesseractPromise=null;
function loadTesseract(){
 if(window.Tesseract)return Promise.resolve(window.Tesseract);
 if(tesseractPromise)return tesseractPromise;
 tesseractPromise=new Promise((resolve,reject)=>{
  const existing=document.querySelector('script[data-the-door-tesseract]');
  if(existing){existing.addEventListener("load",()=>resolve(window.Tesseract));existing.addEventListener("error",()=>reject(new Error("TESSERACT_LOAD_FAILED")));return}
  const script=document.createElement("script");
  script.src="https://cdn.jsdelivr.net/npm/tesseract.js@5/dist/tesseract.min.js";
  script.async=true;script.dataset.theDoorTesseract="1";
  script.onload=()=>window.Tesseract?resolve(window.Tesseract):reject(new Error("TESSERACT_NOT_AVAILABLE"));
  script.onerror=()=>reject(new Error("TESSERACT_LOAD_FAILED"));
  document.head.appendChild(script);
 });
 return tesseractPromise;
}
function extractTracking(text){
 const clean=String(text||"").toUpperCase().replace(/[^A-Z0-9\n ]/g," ");
 const labeled=clean.match(/(?:TRACKING|RASTREIO|CODIGO|C[ÓO]DIGO|OBJETO)[\s:#-]*([A-Z]{2}\d{8,12}[A-Z]{2})/i);
 if(labeled?.[1])return labeled[1];
 const candidates=clean.match(/\b[A-Z]{2}\d{8,12}[A-Z]{2}\b/g)||[];
 return candidates.sort((a,b)=>b.length-a.length)[0]||"";
}
function normalizeOCRText(value){
 return String(value||"").toUpperCase().normalize("NFD").replace(/[\u0300-\u036f]/g,"").replace(/[^A-Z0-9 ]/g," ").replace(/\s+/g," ").trim();
}
function levenshtein(a,b){
 a=String(a||""); b=String(b||"");
 if(a===b)return 0;
 if(!a.length)return b.length;
 if(!b.length)return a.length;
 const prev=Array.from({length:b.length+1},(_,i)=>i);
 for(let i=1;i<=a.length;i++){
  const cur=[i];
  for(let j=1;j<=b.length;j++)cur[j]=Math.min(cur[j-1]+1,prev[j]+1,prev[j-1]+(a[i-1]===b[j-1]?0:1));
  for(let j=0;j<cur.length;j++)prev[j]=cur[j];
 }
 return prev[b.length];
}
function tokenSimilarity(a,b){
 a=normalizeOCRText(a); b=normalizeOCRText(b);
 if(!a||!b)return 0;
 if(a===b)return 1;
 if(a.includes(b)||b.includes(a))return Math.min(a.length,b.length)/Math.max(a.length,b.length);
 return 1-(levenshtein(a,b)/Math.max(a.length,b.length));
}
function detectCarrier(text){
 const t=normalizeOCRText(text).toLowerCase();
 const carriers=[
  ["Correios",["correios","sedex","pac"]],["Mercado Livre",["mercado livre","mercadolivre","meli"]],
  ["Shopee",["shopee"]],["Amazon",["amazon"]],["Shein",["shein"]],["TikTok Shop",["tiktok shop","tiktok"]],
  ["Temu",["temu"]],["Jadlog",["jadlog"]],["Loggi",["loggi"]],["Total Express",["total express"]],
  ["J&T Express",["j&t","j&t express"]]
 ];
 return carriers.find(([name,terms])=>terms.some(term=>t.includes(term)))?.[0]||"";
}
function extractUnitFromText(text){
 const t=normalizeOCRText(text);
 const blockMatch=t.match(/\b(?:BLOCO|BL|BLOCK)\s*[:#.-]?\s*([A-Z0-9]{1,6})\b/);
 const aptMatch=t.match(/\b(?:APTO|APT|APARTAMENTO|AP|UNIDADE|UNID)\s*[:#.-]?\s*([A-Z0-9]{1,8})\b/);
 return {block:blockMatch?.[1]||"",apt:aptMatch?.[1]||""};
}
function scoreResidentAgainstLabel(resident,text){
 const t=normalizeOCRText(text);
 const name=normalizeOCRText(resident?.name);
 if(!name)return 0;
 let score=0;
 if(t.includes(name))score+=0.82;
 const nameTokens=name.split(" ").filter(x=>x.length>=3);
 const ocrTokens=t.split(" ").filter(x=>x.length>=3);
 if(nameTokens.length&&ocrTokens.length){
  let total=0;
  for(const nt of nameTokens){
   let best=0;
   for(const ot of ocrTokens)best=Math.max(best,tokenSimilarity(nt,ot));
   total+=best;
  }
  score+=Math.min(.58,(total/nameTokens.length)*.58);
 }
 const unit=extractUnitFromText(text);
 if(unit.block&&normalizeOCRText(resident.block)===unit.block)score+=.16;
 if(unit.apt&&normalizeOCRText(resident.apt)===unit.apt)score+=.20;
 return Math.min(1,score);
}
function findResidentFromLabel(residents,text){
 const ranked=(residents||[]).map(r=>({resident:r,score:scoreResidentAgainstLabel(r,text)})).sort((a,b)=>b.score-a.score);
 const best=ranked[0];
 return best&&best.score>=0.52?best:null;
}
function preprocessOCRImage(image,mode){
 return new Promise((resolve,reject)=>{
  const img=new Image(); img.onload=()=>{
   const max=2200, scale=Math.min(1.6,max/Math.max(img.width,img.height));
   const w=Math.max(1,Math.round(img.width*scale)), h=Math.max(1,Math.round(img.height*scale));
   const c=document.createElement("canvas"); c.width=w; c.height=h;
   const ctx=c.getContext("2d");
   ctx.drawImage(img,0,0,w,h);
   const d=ctx.getImageData(0,0,w,h); const px=d.data;
   for(let i=0;i<px.length;i+=4){
    const g=0.299*px[i]+0.587*px[i+1]+0.114*px[i+2];
    if(mode==="contrast"){
     const v=Math.max(0,Math.min(255,(g-128)*1.75+128)); px[i]=px[i+1]=px[i+2]=v;
    }else if(mode==="threshold"){
     const v=g>160?255:g<105?0:128; px[i]=px[i+1]=px[i+2]=v;
    }else{px[i]=px[i+1]=px[i+2]=g;}
   }
   ctx.putImageData(d,0,0); resolve(c.toDataURL("image/jpeg",0.9));
  }; img.onerror=reject; img.src=image;
 });
}
let ocrWorkerPromise=null;
async function getOCRWorker(Tesseract){
 if(!ocrWorkerPromise){ocrWorkerPromise=Tesseract.createWorker("por+eng");}
 return await ocrWorkerPromise;
}
async function recognizeBestOCR(Tesseract,image){
 const worker=await getOCRWorker(Tesseract);
 const variants=[];
 // Leitura rápida: duas passagens costumam ser suficientes para etiquetas logísticas.
 for(const [mode,psm] of [["original","11"],["contrast","6"]]){
  try{
   const src=mode==="original"?image:await preprocessOCRImage(image,mode);
   await worker.setParameters({tessedit_pageseg_mode:psm});
   const result=await worker.recognize(src);
   const text=String(result?.data?.text||"").trim();
   const confidence=Number(result?.data?.confidence||0)/100;
   const useful=(text.match(/[A-Za-zÀ-ÿ0-9]{3,}/g)||[]).length;
   variants.push({text,confidence,score:confidence+Math.min(.2,useful/250),mode:`ocr-local-${mode}-psm${psm}`});
  }catch{}
 }
 return variants.sort((a,b)=>b.score-a.score)[0]||{text:"",confidence:0,mode:"ocr-local"};
}
async function analyzeLabelWithAI(image){
 if(AI_LABEL_ENDPOINT){
  const res=await fetch(AI_LABEL_ENDPOINT,{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({image})});
  if(!res.ok)throw new Error("AI_LABEL_REQUEST_FAILED");
  return await res.json();
 }
 const Tesseract=await loadTesseract();
 const best=await recognizeBestOCR(Tesseract,image);
 const text=best.text||"";
 const unit=extractUnitFromText(text);
 return {tracking:extractTracking(text),carrier:detectCarrier(text),recipientName:"",block:unit.block,apt:unit.apt,ocrText:text,confidence:best.confidence,mode:best.mode};
}
// WhatsApp gratuito: abre uma conversa com texto preenchido; o usuário confirma o envio.
function phoneForWhatsApp(phone){
 let n=String(phone||"").replace(/\D/g,"");
 if(n.startsWith("00")) n=n.slice(2);
 if(n.length===10||n.length===11) n="55"+n;
 return n;
}
function whatsappUrl(phone,message){
 const n=phoneForWhatsApp(phone);
 if(!n||n.length<12) return null;
 return "https://wa.me/"+n+"?text="+encodeURIComponent(message);
}
function openWhatsAppChat(phone,message){
 const url=whatsappUrl(phone,message);
 if(!url) return false;
 // Abre em outra aba/janela para manter o The Door aberto no celular e computador.
 const win=window.open(url,"_blank");
 if(!win) return false;
 return true;
}
async function provisionInvitedUser(firebaseUser){
 const email=normalizeEmail(firebaseUser?.email);
 if(!email)return false;
 const profileRef=doc(db,"usuarios",firebaseUser.uid);
 const profileSnap=await getDoc(profileRef);
 if(profileSnap.exists())return true;
 const inviteSnap=await getDoc(doc(db,"convites",email));
 if(!inviteSnap.exists())return false;
 const invite=inviteSnap.data();
 if(invite.status!=="pending"||normalizeEmail(invite.email)!==email||!invite.condominioId)return false;
 await setDoc(profileRef,{nome:invite.nome||firebaseUser.displayName||"",email,role:invite.role||"admin",status:"active",condominioId:String(invite.condominioId),createdAt:serverTimestamp()});
 try{await updateDoc(doc(db,"convites",email),{status:"accepted",acceptedAt:serverTimestamp()});}catch{}
 return true;
}

function AppContent({user,onLogout}){
 const [data,setData]=useState(initial); const [tab,setTab]=useState("home"); const [query,setQuery]=useState("");
 const [showAdd,setShowAdd]=useState(false); const [showCorrespondence,setShowCorrespondence]=useState(false); const [sharingCorrespondence,setSharingCorrespondence]=useState(null); const [menuOpen,setMenuOpen]=useState(false); const [showResident,setShowResident]=useState(false); const [residentEdit,setResidentEdit]=useState(null); const [residentUnit,setResidentUnit]=useState(null); const [showCourier,setShowCourier]=useState(false); const [scan,setScan]=useState(false); const [qrOrder,setQrOrder]=useState(null); const [pickupReceiptOrders,setPickupReceiptOrders]=useState([]);
 const [notice,setNotice]=useState(""); const [editingNotification,setEditingNotification]=useState(null); const [selectedOrderIds,setSelectedOrderIds]=useState([]); const [identifyingOrder,setIdentifyingOrder]=useState(null);
 const [tenantId,setTenantId]=useState(""); const [tenantName,setTenantName]=useState(""); const [cloudReady,setCloudReady]=useState(false); const [cloudError,setCloudError]=useState("");
 const lastCloudJson=useRef(""); const applyingCloud=useRef(false);
 // O perfil do usuário é provisionado pelo administrador no Firestore; o cliente não pode definir seu próprio condomínio.
 useEffect(()=>{
  let stopData=null; let active=true;
  async function connect(){
   try{
    const profileSnap=await getDoc(doc(db,"usuarios",user.uid));
    if(!active)return;
    if(!profileSnap.exists()) {setCloudError("Seu usuário ainda não foi vinculado a um condomínio. Peça ao administrador do The Door para concluir seu cadastro.");return;}
    const profile=profileSnap.data();
    if(profile.status!=="active"||!profile.condominioId){setCloudError("Seu acesso está inativo ou ainda não foi vinculado a um condomínio. Entre em contato com o administrador.");return;}
    const cid=String(profile.condominioId); setTenantId(cid);
    const condoSnap=await getDoc(doc(db,"condominios",cid));
    if(!active)return;
    if(condoSnap.exists()){
     const condo=condoSnap.data(), license=condo.licenca||{};
     setTenantName(String(condo.nome||"Condomínio"));
     const today=new Date().toISOString().slice(0,10);
     if(["suspenso","inativo"].includes(String(condo.status||"").toLowerCase()) || ["suspensa","suspenso","expirada","cancelada"].includes(String(license.status||"").toLowerCase()) || (license.vencimento&&license.vencimento<today)){
      setCloudError("A licença deste condomínio está suspensa ou vencida. Entre em contato com o administrador do The Door para regularizar o acesso.");return;
     }
    }
    const dataRef=doc(db,"condominios",cid,"dados","app");
    stopData=onSnapshot(dataRef,async snap=>{
     if(!active)return;
     if(!snap.exists()){
      try{await setDoc(dataRef,{residents:[],couriers:[],orders:[],correspondences:[],updatedAt:serverTimestamp()},{merge:false});}catch(e){if(active)setCloudError("Não foi possível inicializar os dados do condomínio. Confira as regras do Firestore.");}
      return;
     }
     const cloud=snap.data(); const clean={residents:Array.isArray(cloud.residents)?cloud.residents:[],couriers:Array.isArray(cloud.couriers)?cloud.couriers:[],orders:Array.isArray(cloud.orders)?cloud.orders:[],correspondences:Array.isArray(cloud.correspondences)?cloud.correspondences:[]};
     lastCloudJson.current=JSON.stringify(stripPhotos(clean));
     applyingCloud.current=true;
     setData(current=>mergeLocalPhotos(clean,current));
     setCloudError(""); setCloudReady(true);
     Promise.resolve().then(()=>{applyingCloud.current=false;});
    },e=>{if(active)setCloudError("Falha ao sincronizar com o Firestore. Confira as regras e o vínculo do usuário.");});
   }catch(e){if(active)setCloudError(e.code==="permission-denied"?"Acesso negado pelo Firestore. Confira o cadastro do usuário e as regras de segurança.":"Não foi possível conectar ao Firestore. Verifique a conexão e as configurações do Firebase.");}
  }
  connect(); return ()=>{active=false;if(stopData)stopData();};
 },[user.uid]);
 useEffect(()=>{
  if(!cloudReady||!tenantId||applyingCloud.current)return;
  const cloudData=stripPhotos(data); const json=JSON.stringify(cloudData);
  if(json===lastCloudJson.current)return;
  const timer=setTimeout(async()=>{
   try{await setDoc(doc(db,"condominios",tenantId,"dados","app"),{...cloudData,updatedAt:serverTimestamp()});lastCloudJson.current=json;setCloudError("");}
   catch(e){setCloudError("Não foi possível salvar na nuvem. Verifique a conexão e as regras do Firestore.");}
  },500);
  return ()=>clearTimeout(timer);
 },[data,cloudReady,tenantId]);

 const orders=data.orders;
 const pending=orders.filter(o=>o.status==="Pendente");
 const notificationQueue=orders.filter(o=>o.status==="Pendente"&&o.notificationStatus!=="sent");
 const filtered=useMemo(()=>orders.filter(o=>JSON.stringify(o).toLowerCase().includes(query.toLowerCase())),[orders,query]);
 function notify(x){setNotice(x);setTimeout(()=>setNotice(""),2500)}
 function notificationMessage(order, kind="arrival"){
  const r=data.residents.find(x=>x.id===order.residentId);
  if(!r)return null;
  if(kind==="pickup")return `Olá, ${r.name}! Confirmamos que sua encomenda ${order.code} foi retirada na portaria. Obrigado!`;
  const template=order.customMessage||"Olá, {morador}! Sua encomenda {codigo} está disponível para retirada na portaria. Apresente o QR Code da encomenda ou informe o código {rastreio} ao atendente. Obrigado!";
  return String(template).replaceAll("{morador}",r.name||"morador").replaceAll("{codigo}",order.code||"").replaceAll("{rastreio}",order.tracking||order.code||"");
 }
 function saveEditedNotification(id,message){
  setData(d=>({...d,orders:d.orders.map(o=>o.id===id?{...o,customMessage:message.trim()}:o)}));
  setEditingNotification(null);notify("Mensagem atualizada. Ela estará pronta ao abrir o WhatsApp.");
 }
 async function analyzePendingOrder(order){
  if(!order?.photo)return;
  setData(d=>({...d,orders:d.orders.map(x=>x.id===order.id?{...x,identificationStatus:"reading"}:x)}));
  try{
   const result=await analyzeLabelWithAI(order.photo);
   const rawText=String(result?.ocrText||"");
   const unit=extractUnitFromText(rawText);
   const match=findResidentFromLabel(data.residents,rawText);
   const matched=match?.resident||null;
   const resolvedBlock=result?.block||unit.block||matched?.block||"";
   const resolvedApt=result?.apt||unit.apt||matched?.apt||"";
   const enriched={...(result||{}),block:resolvedBlock,apt:resolvedApt,recipientName:result?.recipientName||matched?.name||"",matchedResidentId:matched?.id||"",matchScore:match?.score||0,matchedResidentName:matched?.name||""};
   setData(d=>({...d,orders:d.orders.map(x=>x.id===order.id?{...x,aiLabel:enriched,identificationStatus:"ready",tracking:enriched.tracking||x.tracking||"",courier:enriched.carrier||x.courier||"",residentId:matched?.id||x.residentId||"",residentName:matched?.name||x.residentName||"",address:matched?`${matched.block||""} / ${matched.apt||""}`:x.address||""}:x)}));
  }catch(e){
   setData(d=>({...d,orders:d.orders.map(x=>x.id===order.id?{...x,identificationStatus:"error"}:x)}));
  }
 }
 function confirmIdentification(order,residentId){
  const resident=data.residents.find(r=>r.id===residentId);
  if(!resident){notify("Selecione um morador antes de confirmar.");return;}
  const ai=order.aiLabel||{};
  const updated={...order,residentId,residentName:resident.name,address:`${resident.block||""} / ${resident.apt||""}`,tracking:ai.tracking||order.tracking||"",courier:ai.carrier||order.courier||"",identificationStatus:"identified",identifiedAt:new Date().toISOString()};
  setData(d=>({...d,orders:d.orders.map(x=>x.id===order.id?updated:x)}));
  setIdentifyingOrder(null);
  setTab("orders");
  notify("Encomenda identificada e registrada. Agora você pode avisar o morador.");
 }
 function addOrder(o){
  const {notificationChoice="later",...orderFields}=o;
  const newOrder={...orderFields,id:uid("enc"),code:"TD-"+Math.random().toString(36).slice(2,8).toUpperCase(),status:"Pendente",receivedAt:new Date().toISOString(),notificationStatus:"pending",identificationStatus:o.identificationStatus||"pending"};
  setData(d=>({...d,orders:[newOrder,...d.orders]}));
  setShowAdd(false);
  setTab("pending");
  notify("Encomenda recebida e enviada para Pendências.");
 }
 function openQueuedNotification(order){
  const r=data.residents.find(x=>x.id===order.residentId);
  if(!r){notify("Não há morador vinculado a esta encomenda.");return}
  const msg=notificationMessage(order);
  if(!phoneForWhatsApp(r.phone)||phoneForWhatsApp(r.phone).length<12){notify("Confira o telefone do morador com DDD e código do país.");return}
  if(openWhatsAppChat(r.phone,msg))notify("Conversa aberta. Envie a mensagem no WhatsApp e depois volte para marcar como enviada.");
  else notify("Não foi possível abrir a conversa. Permita pop-ups e tente novamente.");
 }
 function markNotificationSent(id){
  setData(d=>({...d,orders:d.orders.map(o=>o.id===id?{...o,notificationStatus:"sent",notifiedAt:new Date().toISOString()}:o)}));
  notify("Aviso marcado como enviado.");
 }
 function toggleOrderSelection(id){setSelectedOrderIds(ids=>ids.includes(id)?ids.filter(x=>x!==id):[...ids,id])}
 function selectAllPending(){setSelectedOrderIds(pending.map(o=>o.id))}
 function clearOrderSelection(){setSelectedOrderIds([])}
 function bulkDeliver(ids=selectedOrderIds){
  const unique=[...new Set(ids)].filter(id=>orders.some(o=>o.id===id&&o.status==="Pendente"));
  if(!unique.length){notify("Selecione pelo menos uma encomenda pendente.");return}
  if(!confirm(`Confirmar a retirada de ${unique.length} encomenda(s) selecionada(s)?`))return;
  const now=new Date().toISOString();
  const pickedOrders=unique.map(id=>orders.find(o=>o.id===id)).filter(Boolean).map(o=>({...o,status:"Retirada",pickedAt:now,pickupMethod:"manual",notificationStatus:o.notificationStatus}));
  setData(d=>({...d,orders:d.orders.map(o=>unique.includes(o.id)?{...o,status:"Retirada",pickedAt:now,pickupMethod:"manual",notificationStatus:o.notificationStatus}:o)}));
  setSelectedOrderIds([]);
  setPickupReceiptOrders(pickedOrders);
  notify(`${unique.length} encomenda(s) marcada(s) como retirada.`);
 }
 function notificationGroups(){
  const groups=new Map();
  notificationQueue.forEach(o=>{const key=o.residentId||o.residentName||o.id;if(!groups.has(key))groups.set(key,[]);groups.get(key).push(o);});
  return [...groups.values()].sort((a,b)=>{const ra=data.residents.find(r=>r.id===a[0].residentId),rb=data.residents.find(r=>r.id===b[0].residentId);return String(ra?.name||a[0].residentName||"").localeCompare(String(rb?.name||b[0].residentName||""),"pt-BR")});
 }
 function groupedNotificationMessage(list){
  const first=list[0]; const r=data.residents.find(x=>x.id===first?.residentId); if(!r)return null;
  const lines=list.map(o=>`• ${o.code}${o.tracking?` — rastreio ${o.tracking}`:""}`);
  return `Olá, ${r.name}! Você possui ${list.length} encomenda${list.length===1?"":"s"} disponível${list.length===1?"":"eis"} para retirada na portaria:\n\n${lines.join("\n")}\n\nTodas estão disponíveis para retirada. Obrigado!`;
 }
 function openGroupedNotification(list){
  const r=data.residents.find(x=>x.id===list[0]?.residentId);
  if(!r){notify("Não há morador vinculado a estas encomendas.");return}
  if(!phoneForWhatsApp(r.phone)||phoneForWhatsApp(r.phone).length<12){notify("Confira o telefone do morador com DDD e código do país.");return}
  const msg=groupedNotificationMessage(list);
  if(openWhatsAppChat(r.phone,msg))notify(`Conversa de ${r.name} aberta com ${list.length} encomenda(s). Depois de enviar, marque o grupo como enviado.`);
  else notify("Não foi possível abrir a conversa. Permita pop-ups e tente novamente.");
 }
 function markNotificationGroupSent(list){
  const ids=list.map(o=>o.id);
  setData(d=>({...d,orders:d.orders.map(o=>ids.includes(o.id)?{...o,notificationStatus:"sent",notifiedAt:new Date().toISOString()}:o)}));
  notify(`${list.length} aviso(s) marcado(s) como enviado(s).`);
 }
 function removeOrder(id){if(confirm("Excluir esta encomenda?"))setData(d=>({...d,orders:d.orders.filter(o=>o.id!==id)}))}
 function removeResident(id){
  const resident=data.residents.find(r=>r.id===id);
  if(!resident)return;
  const pendingOrders=data.orders.filter(o=>o.residentId===id&&o.status==="Pendente").length;
  const pendingCorrespondences=data.correspondences.filter(c=>c.residentId===id&&c.status!=="Entregue").length;
  if(pendingOrders||pendingCorrespondences){
   const parts=[];
   if(pendingOrders)parts.push(`${pendingOrders} encomenda(s) pendente(s)`);
   if(pendingCorrespondences)parts.push(`${pendingCorrespondences} correspondência(s) pendente(s)`);
   notify(`Não é possível excluir ${resident.name}. Há ${parts.join(" e ")} vinculada(s) a este morador.`);
   return;
  }
  if(!confirm(`Excluir o cadastro de ${resident.name}? O histórico de encomendas e correspondências será mantido.`))return;
  setData(d=>({...d,residents:d.residents.filter(r=>r.id!==id)}));
  notify("Morador excluído. O histórico foi preservado.");
}
 function deliver(id){
  const o=orders.find(x=>x.id===id);
  if(!o)return;
  const picked={...o,status:"Retirada",pickedAt:new Date().toISOString(),pickupMethod:"manual"};
  setData(d=>({...d,orders:d.orders.map(x=>x.id===id?picked:x)}));
  setPickupReceiptOrders([picked]);
  notify("Retirada registrada. Comprovante pronto para compartilhar com o morador.");
 }
 function scannedCheckout(value){
  const clean=value.trim();
  const o=orders.find(x=>x.status==="Pendente"&&(String(x.code).toLowerCase()===clean.toLowerCase()||String(x.tracking||"").toLowerCase()===clean.toLowerCase()));
  if(!o){notify("Código não encontrado entre as encomendas pendentes.");return}
  const method=String(o.code).toLowerCase()===clean.toLowerCase()?"QR Code":"código de barras";
  const picked={...o,status:"Retirada",pickedAt:new Date().toISOString(),pickupMethod:method};
  setData(d=>({...d,orders:d.orders.map(x=>x.id===o.id?picked:x)}));
  setScan(false);setQrOrder(null);
  setPickupReceiptOrders([picked]);
  notify("Retirada registrada. Comprovante pronto para compartilhar com o morador.");
 }
 function openWhatsApp(phone,msg){if(!whatsappUrl(phone,msg)){notify("Confira o telefone do morador com DDD e código do país antes de enviar pelo WhatsApp.");return}if(!openWhatsAppChat(phone,msg))notify("O navegador bloqueou a nova janela. Permita pop-ups para o The Door e tente novamente.")}
  async function sendWhatsApp(o){
  const r=data.residents.find(x=>x.id===o.residentId);
  if(!r){notify("Cadastre ou vincule um morador para enviar a mensagem.");return}
  const msg=`Olá, ${r.name}! Sua encomenda ${o.code} está disponível para retirada na portaria. Apresente o QR Code desta encomenda ou informe o código ${o.tracking||o.code} ao atendente. Obrigado!`;
  try{
   const qrData=await QRCode.toDataURL(o.code,{width:520,margin:2,errorCorrectionLevel:"M"});
   const blob=await (await fetch(qrData)).blob();
   const file=new File([blob],`The-Door-${o.code}.png`,{type:"image/png"});
   if(navigator.share && navigator.canShare && navigator.canShare({files:[file]})){
    await navigator.share({files:[file],title:`The Door - ${o.code}`,text:msg});
    notify("Comunicado preparado com QR Code e mensagem. Confirme o envio no WhatsApp.");
    return;
   }
  }catch(e){}
  // Fallback: quando o navegador não permite compartilhar arquivo, abre o WhatsApp com a mensagem.
  openWhatsApp(r.phone,msg);
 }
  function sendPickupConfirmation(o,method){setPickupReceiptOrders([{...o,pickupMethod:method||o.pickupMethod||"manual"}]);}
 function addCorrespondence(c){const resident=data.residents.find(x=>x.id===c.residentId);const item={...c,id:uid("cor"),status:"Aguardando",receivedAt:new Date().toISOString(),residentName:resident?.name||"",address:resident?`${resident.block||""} / ${resident.apt||""}`:""};setData(d=>({...d,correspondences:[item,...d.correspondences]}));setShowCorrespondence(false);notify("Correspondência cadastrada com sucesso.")}
 function deliverCorrespondence(id){setData(d=>({...d,correspondences:d.correspondences.map(c=>c.id===id?{...c,status:"Entregue",deliveredAt:new Date().toISOString()}:c)}));notify("Correspondência marcada como entregue.")}
 function removeCorrespondence(id){if(confirm("Excluir esta correspondência?"))setData(d=>({...d,correspondences:d.correspondences.filter(c=>c.id!==id)}))}
 if(cloudError&&!cloudReady)return <div className="auth-screen"><div className="auth-card"><img src={brandIcon} alt="Logo The Door"/><h1>The Door</h1><p>{cloudError}</p><button className="primary wide" onClick={()=>signOut(auth)}>Sair</button></div></div>;
 if(!cloudReady)return <div className="auth-screen"><div className="auth-card"><img src={brandIcon} alt="Logo The Door"/><h1>The Door</h1><p>Conectando ao condomínio e sincronizando os dados...</p></div></div>;
 return <div className="app">
  <header><div className="brand"><img className="brand-logo" src={brandIcon} alt="Logo The Door"/><div><b>THE DOOR</b><small className="condo-name">{tenantName||"Condomínio"}</small><small>Gestão de encomendas e correspondências</small></div></div><div className="header-actions"><span className="user-email">{user.email||user.displayName||"Usuário"}</span><button className="icon-menu-btn" onClick={()=>setMenuOpen(true)} title="Menu"><Menu/></button><button onClick={onLogout}><LogOut/> Sair</button></div></header>
  <main>
   {tab==="pending"&&<PendingIdentification data={data} onOpen={setIdentifyingOrder} onAnalyze={analyzePendingOrder}/>}
   {tab==="home"&&<Dashboard pending={pending} orders={orders} onAdd={()=>setShowAdd(true)} onScan={()=>setScan(true)} onWhats={sendWhatsApp} onDeliver={deliver} onDelete={removeOrder} onShowQr={setQrOrder}/>}
   {tab==="orders"&&<><SectionTitle icon={<History/>} title="Encomendas"/><div className="toolbar"><div className="search"><Search/><input value={query} onChange={e=>setQuery(e.target.value)} placeholder="Buscar código, morador, apartamento..."/></div><button className="primary" onClick={()=>setShowAdd(true)}><Plus/> Nova encomenda</button></div><div className="bulk-bar"><div><b>{selectedOrderIds.length} selecionada(s)</b><small>Use a seleção para dar baixa em várias encomendas de uma vez.</small></div><div className="bulk-actions"><button onClick={selectAllPending}>Selecionar pendentes</button><button onClick={clearOrderSelection} disabled={!selectedOrderIds.length}>Limpar</button><button className="primary" onClick={()=>bulkDeliver()} disabled={!selectedOrderIds.length}><CheckCircle2/> Dar baixa em lote</button></div></div><OrderList orders={filtered} data={data} onWhats={sendWhatsApp} onDeliver={deliver} onDelete={removeOrder} onShowQr={setQrOrder} onConfirmPickup={sendPickupConfirmation} selectable selectedIds={selectedOrderIds} onToggleSelect={toggleOrderSelection}/></>}
   {tab==="correspondence"&&<><SectionTitle icon={<Mail/>} title="Cartas e correspondências"/><div className="toolbar"><div className="search"><Search/><input value={query} onChange={e=>setQuery(e.target.value)} placeholder="Buscar morador, remetente, código ou tipo..."/></div><button className="primary" onClick={()=>setShowCorrespondence(true)}><Plus/> Nova correspondência</button></div>{data.correspondences.filter(c=>JSON.stringify(c).toLowerCase().includes(query.toLowerCase())).length===0?<div className="empty">Nenhuma correspondência cadastrada.</div>:<div className="cards">{data.correspondences.filter(c=>JSON.stringify(c).toLowerCase().includes(query.toLowerCase())).map(c=>{const r=data.residents.find(x=>x.id===c.residentId);return <div className="card order" key={c.id}><div className="order-main"><div className="code">{c.type||"Correspondência"}</div><b>{r?.name||c.residentName||"Morador não vinculado"}</b><small>{r?`Bloco ${r.block||"—"} • Apto ${r.apt||"—"}`:c.address||"Unidade não informada"}</small><small>Remetente: {c.sender||"Não informado"}</small>{c.tracking&&<small>Código: {c.tracking}</small>}<small>Recebida: {new Date(c.receivedAt).toLocaleString("pt-BR")}</small><span className={c.status==="Entregue"?"badge done":"badge"}>{c.status}</span></div><div className="order-actions"><button title="Enviar aviso pelo WhatsApp" onClick={()=>setSharingCorrespondence(c)}><Send/></button>{c.status!=="Entregue"&&<button className="ok" title="Marcar como entregue" onClick={()=>deliverCorrespondence(c.id)}><CheckCircle2/></button>}<button className="danger" title="Excluir" onClick={()=>removeCorrespondence(c.id)}><Trash2/></button></div></div>})}</div>}</>}
   {tab==="residents"&&<><SectionTitle icon={<Users/>} title="Moradores por unidade"/><div className="toolbar"><div className="search"><Search/><input value={query} onChange={e=>setQuery(e.target.value)} placeholder="Buscar nome, telefone, bloco ou apartamento..."/></div><button className="primary" onClick={()=>{setResidentEdit(null);setResidentUnit(null);setShowResident(true)}}><Plus/> Cadastrar morador</button></div><div className="unit-list">{Object.entries(data.residents.filter(r=>JSON.stringify(r).toLowerCase().includes(query.toLowerCase())).reduce((groups,r)=>{const key=[r.block,r.street,r.quadra,r.apt].map(v=>(v||"").trim().toLowerCase()).join("|");if(!groups[key])groups[key]={key,block:r.block,street:r.street,quadra:r.quadra,apt:r.apt,residents:[]};groups[key].residents.push(r);return groups;},{})).sort((a,b)=>`${a[1].street} ${a[1].quadra} ${a[1].block} ${a[1].apt}`.localeCompare(`${b[1].street} ${b[1].quadra} ${b[1].block} ${b[1].apt}`,"pt-BR")).map(([key,u])=><div className="card unit-card" key={key}><div className="unit-heading"><div className="unit-icon"><MapPin/></div><div className="unit-title"><b>Unidade {u.apt||"não informada"}</b><small>{[u.block&&`Bloco ${u.block}`,u.street,u.quadra&&`Quadra ${u.quadra}`].filter(Boolean).join(" • ")||"Endereço não informado"}</small><small>{u.residents.length} morador(es) cadastrado(s)</small></div><button className="unit-add" onClick={()=>{setResidentEdit(null);setResidentUnit(u);setShowResident(true)}}><UserPlus/> Adicionar</button></div><div className="unit-residents">{u.residents.map(r=><div className="resident-row" key={r.id}><div className="resident-info"><b>{r.name}</b><small>{r.relationship?`Vínculo: ${r.relationship} • `:""}WhatsApp: {r.phone||"Não informado"}</small></div><div className="resident-actions"><button className="edit-resident" title="Editar morador" onClick={()=>{setResidentEdit(r);setResidentUnit(null);setShowResident(true)}}><Pencil/> Editar</button><button className="delete-resident" title="Excluir morador" onClick={()=>removeResident(r.id)}><Trash2/> Excluir</button></div></div>)}</div></div>)}</div>{data.residents.length===0&&<div className="empty">Nenhum morador cadastrado. Use “Cadastrar morador” para começar.</div>}</>}
   {tab==="notifications"&&<><SectionTitle icon={<MessageSquare/>} title="Central de Notificações"/><div className="notification-intro card"><b>{notificationQueue.length} encomenda(s) aguardando aviso</b><small>O The Door agrupa automaticamente as encomendas por morador. Assim, se um morador tiver 3 encomendas para avisar, você envia uma única mensagem com as 3.</small></div>{notificationQueue.length===0?<div className="empty">Nenhum aviso pendente. As encomendas marcadas para “Enviar depois” aparecerão aqui.</div>:<div className="cards">{notificationGroups().map(group=>{const r=data.residents.find(x=>x.id===group[0].residentId);return <div className="card notification-card" key={group[0].residentId||group[0].id}><div className="order-main"><div className="code">{group.length} encomenda{group.length===1?"":"s"}</div><b>{r?.name||group[0].residentName||"Morador não vinculado"}</b><small>{r?`Bloco ${r.block||"—"} • Apto ${r.apt||"—"}`:group[0].address||"Unidade não informada"}</small><small>{group.map(o=>o.code).join(" • ")}</small><span className="badge">Aviso pendente</span></div><div className="notification-actions"><button onClick={()=>group.forEach(o=>setEditingNotification(o))} title="Editar mensagem individual">Editar mensagem</button><button className="primary" onClick={()=>openGroupedNotification(group)}><Send size={16}/> Enviar {group.length===1?"aviso":"os avisos"}</button><button onClick={()=>{if(confirm(`Confirma que a mensagem de ${group.length} encomenda(s) foi enviada pelo WhatsApp?`))markNotificationGroupSent(group)}}><CheckCircle2 size={16}/> Marcar enviado</button></div></div>})}</div>}</>}
   {tab==="couriers"&&<><SectionTitle icon={<Truck/>} title="Entregadores"/><div className="toolbar"><button className="primary" onClick={()=>setShowCourier(true)}><Plus/> Cadastrar entregador</button></div><div className="cards">{data.couriers.map(c=><div className="card" key={c.id}><b>{c.name}</b><small>{c.company||"Sem empresa"} • {c.phone||"Sem telefone"}</small><small>Documento: {c.doc||"—"} • Placa: {c.plate||"—"}</small></div>)}</div></>}
   {tab==="history"&&<><SectionTitle icon={<History/>} title="Histórico de retiradas"/><OrderList orders={orders.filter(o=>o.status==="Retirada")} data={data} onWhats={sendWhatsApp} onDeliver={deliver} onDelete={removeOrder} onShowQr={setQrOrder} onConfirmPickup={sendPickupConfirmation}/></>}
  </main>
  <nav className="bottom-nav">{[["home","Início",Home],["pending","Pendências",Clock],["orders","Encomendas",PackagePlus],["correspondence","Cartas",Mail],["menu","Menu",Menu]].map(([k,l,I])=><button className={tab===k?"active":""} onClick={()=>k==="menu"?setMenuOpen(true):setTab(k)} key={k}><I/><span>{l}</span></button>)}</nav>
  {menuOpen&&<div className="menu-overlay" onClick={()=>setMenuOpen(false)}><div className="side-menu" onClick={e=>e.stopPropagation()}><div className="side-menu-head"><div><b>Menu</b><small>{tenantName||"Condomínio"}</small></div><button onClick={()=>setMenuOpen(false)}><X/></button></div><button onClick={()=>{setTab("notifications");setMenuOpen(false)}}><MessageSquare/> Avisos</button><button onClick={()=>{setTab("residents");setMenuOpen(false)}}><Users/> Moradores</button><button onClick={()=>{setTab("couriers");setMenuOpen(false)}}><Truck/> Entregadores</button><button onClick={()=>{setTab("history");setMenuOpen(false)}}><Clock/> Histórico</button><div className="menu-divider"/><button onClick={onLogout}><LogOut/> Sair</button></div></div>}
  {identifyingOrder&&<IdentifyOrderModal order={identifyingOrder} data={data} onClose={()=>setIdentifyingOrder(null)} onConfirm={confirmIdentification}/>}
  {showAdd&&<AddOrder data={data} onClose={()=>setShowAdd(false)} onSave={addOrder}/>}
  {showCorrespondence&&<CorrespondenceForm data={data} onClose={()=>setShowCorrespondence(false)} onSave={addCorrespondence}/>}
  {sharingCorrespondence&&<CorrespondenceShareModal correspondence={sharingCorrespondence} resident={data.residents.find(r=>r.id===sharingCorrespondence.residentId)} onClose={()=>setSharingCorrespondence(null)}/>}
  {editingNotification&&<EditNotification order={editingNotification} resident={data.residents.find(r=>r.id===editingNotification.residentId)} initialMessage={notificationMessage(editingNotification)} onClose={()=>setEditingNotification(null)} onSave={message=>saveEditedNotification(editingNotification.id,message)}/>}
  {showResident&&<ResidentForm resident={residentEdit} unit={residentUnit} onClose={()=>{setShowResident(false);setResidentEdit(null);setResidentUnit(null)}} onSave={r=>{setData(d=>({...d,residents:residentEdit?d.residents.map(old=>old.id===residentEdit.id?{...old,...r,id:old.id}:old):[...d.residents,{...r,id:uid("mor")}] }));setShowResident(false);setResidentEdit(null);setResidentUnit(null);notify(residentEdit?"Morador atualizado com sucesso.":"Morador cadastrado na unidade.")}}/>}
  {showCourier&&<CourierForm onClose={()=>setShowCourier(false)} onSave={c=>{setData(d=>({...d,couriers:[...d.couriers,{...c,id:uid("ent")}] }));setShowCourier(false)}}/>}
  {scan&&<Scanner orders={orders} onClose={()=>setScan(false)} onRead={scannedCheckout}/>}
  {qrOrder&&<QrModal order={qrOrder} resident={data.residents.find(r=>r.id===qrOrder.residentId)} onClose={()=>setQrOrder(null)}/> }
  {pickupReceiptOrders.length>0&&<PickupReceiptModal orders={pickupReceiptOrders} residents={data.residents} onClose={()=>setPickupReceiptOrders([])}/> }
  {notice&&<div className="toast">{notice}</div>}
 </div>
}
function SectionTitle({icon,title}){return <div className="section-title">{icon}<h2>{title}</h2></div>}
function Dashboard({pending,orders,onAdd,onScan,onWhats,onDeliver,onDelete,onShowQr}){
 return <><div className="hero"><div><span className="eyebrow">PORTARIA</span><h1>Controle de encomendas</h1><p>Receba, notifique e dê baixa com QR Code.</p></div><div className="hero-buttons"><button className="primary" onClick={onAdd}><PackagePlus/> Nova encomenda</button><button onClick={onScan}><ScanLine/> Ler QR</button></div></div>
 <div className="stats"><Stat icon={<Clock/>} label="Aguardando" value={pending.length}/><Stat icon={<PackagePlus/>} label="Recebidas" value={orders.length}/><Stat icon={<CheckCircle2/>} label="Retiradas" value={orders.filter(o=>o.status==="Retirada").length}/></div>
 <SectionTitle icon={<Clock/>} title="Aguardando retirada"/><OrderList orders={pending.slice(0,6)} data={null} onWhats={onWhats} onDeliver={onDeliver} onDelete={onDelete} onShowQr={onShowQr}/>
 </>}
function Stat({icon,label,value}){return <div className="stat">{icon}<div><small>{label}</small><strong>{value}</strong></div></div>}
function OrderList({orders,data,onWhats,onDeliver,onDelete,onShowQr,onConfirmPickup,selectable=false,selectedIds=[],onToggleSelect}){
 if(!orders.length)return <div className="empty">Nenhuma encomenda encontrada.</div>;
 return <div className="cards">{orders.map(o=><OrderCard key={o.id} o={o} data={data} onWhats={onWhats} onDeliver={onDeliver} onDelete={onDelete} onShowQr={onShowQr} onConfirmPickup={onConfirmPickup} selectable={selectable} selected={selectedIds.includes(o.id)} onToggleSelect={onToggleSelect}/>)}</div>
}
function OrderCard({o,data,onWhats,onDeliver,onDelete,onShowQr,onConfirmPickup,selectable=false,selected=false,onToggleSelect}){
 const resident=data?.residents?.find(r=>r.id===o.residentId); return <div className={`card order${selected?" selected-order":""}`}>{selectable&&o.status==="Pendente"&&<label className="order-select" title="Selecionar encomenda"><input type="checkbox" checked={selected} onChange={()=>onToggleSelect(o.id)}/></label>}{o.photo&&<img className="order-photo" src={o.photo} alt="Foto da encomenda" style={{width:88,height:88,objectFit:"cover",borderRadius:10,flexShrink:0}}/>}<div className="order-main"><div className="code">Código The Door: {o.code}</div>{o.tracking&&<small>Código de barras/rastreio: {o.tracking}</small>}<b>{resident?.name||o.residentName||"Morador"}</b><small>{resident?`${resident.block} • Apto ${resident.apt} • ${resident.street} • ${resident.quadra}`:o.address}</small><small>Recebida: {new Date(o.receivedAt).toLocaleString("pt-BR")}</small><span className={o.status==="Retirada"?"badge done":"badge"}>{o.status}</span></div><div className="order-actions">{onShowQr&&<button title="Ver QR Code próprio" onClick={()=>onShowQr(o)}><ScanLine/></button>}{o.status==="Pendente"&&<button title="WhatsApp" onClick={()=>onWhats(o)}><Send/></button>}{o.status==="Retirada"&&onConfirmPickup&&<button title="Enviar confirmação de retirada pelo WhatsApp" onClick={()=>onConfirmPickup(o,o.pickupMethod||"código de barras")}><Send/></button>}{o.status==="Pendente"&&<button className="ok" title="Dar baixa manual" onClick={()=>onDeliver(o.id)}><CheckCircle2/></button>}<button className="danger" title="Excluir" onClick={()=>onDelete(o.id)}><Trash2/></button></div></div>
}
function Modal({title,children,onClose}){return <div className="overlay"><div className="modal"><div className="modalhead"><h3>{title}</h3><button onClick={onClose}>×</button></div>{children}</div></div>}
function AddOrder({data,onClose,onSave}){
 const [photo,setPhoto]=useState(""); const [busy,setBusy]=useState(false); const [error,setError]=useState("");
 async function handlePhoto(file){
  setError(""); if(!file)return;
  try{
   const dataUrl=await new Promise((resolve,reject)=>{const reader=new FileReader();reader.onload=()=>resolve(reader.result);reader.onerror=reject;reader.readAsDataURL(file)});
   const img=await new Promise((resolve,reject)=>{const image=new Image();image.onload=()=>resolve(image);image.onerror=reject;image.src=dataUrl});
   const max=1280,scale=Math.min(1,max/Math.max(img.width,img.height));
   const canvas=document.createElement("canvas");canvas.width=Math.round(img.width*scale);canvas.height=Math.round(img.height*scale);canvas.getContext("2d").drawImage(img,0,0,canvas.width,canvas.height);
   setPhoto(canvas.toDataURL("image/jpeg",0.78));
  }catch{setError("Não foi possível carregar a foto. Tente novamente.")}
 }
 function save(){
  if(!photo){setError("Tire a foto da etiqueta para receber a encomenda.");return}
  setBusy(true);
  onSave({residentId:"",courier:"",tracking:"",description:"",observations:"",notificationChoice:"later",messageTemplate:"Olá, {morador}! Sua encomenda {codigo} está disponível para retirada na portaria. Apresente o QR Code desta encomenda ou informe o código {rastreio} ao atendente. Obrigado!",photo,residentName:"",address:"",identificationStatus:"pending"});
  setBusy(false);
 }
 return <Modal title="Receber encomenda" onClose={onClose}><div className="form">
  <p className="hint">Tire somente a foto da etiqueta. A encomenda será enviada para <strong>Pendências</strong> e a identificação será feita lá.</p>
  <label>Foto da encomenda / etiqueta<input type="file" accept="image/*" capture="environment" onChange={e=>handlePhoto(e.target.files?.[0])}/></label>
  {photo&&<div className="ai-label-panel"><img src={photo} alt="Prévia da etiqueta"/><div className="ai-label-status">Foto pronta. Ao confirmar, a encomenda vai para Pendências.</div></div>}
  {error&&<p className="hint">{error}</p>}
  <button className="primary wide" disabled={!photo||busy} onClick={save}>{busy?"Salvando...":"Enviar para Pendências"}</button>
 </div></Modal>
}

function PendingIdentification({data,onOpen,onAnalyze}){
 const pending=data.orders.filter(o=>o.status==="Pendente"&&o.identificationStatus!=="identified");
 const [running,setRunning]=useState({});
 useEffect(()=>{
  const target=pending.find(o=>o.photo&&!o.aiLabel&&o.identificationStatus!=="reading");
  if(target&&!running[target.id]){
   setRunning(v=>({...v,[target.id]:true}));
   Promise.resolve(onAnalyze(target)).finally(()=>setRunning(v=>{const n={...v};delete n[target.id];return n;}));
  }
 },[pending.map(o=>o.id+o.identificationStatus+!!o.aiLabel).join("|")]);
 return <><SectionTitle icon={<Clock/>} title="Pendências"/><p className="hint">As fotos entram aqui automaticamente. A leitura da etiqueta acontece sem precisar preencher o cadastro manualmente.</p>{pending.length===0?<div className="empty">Nenhuma encomenda aguardando identificação.</div>:<div className="cards">{pending.map(o=>{const ai=o.aiLabel||{};const resident=data.residents.find(r=>r.id===o.residentId);return <div className="card pending-identification" key={o.id}>{o.photo&&<img className="order-photo" src={o.photo} alt="Etiqueta" style={{width:120,height:120,objectFit:"cover",borderRadius:10}}/>}<div className="order-main"><div className="code">{o.code}</div><b>{ai.matchedResidentName||o.residentName||"Destinatário ainda não confirmado"}</b><small>{ai.tracking||o.tracking?`Rastreio: ${ai.tracking||o.tracking}`:"Rastreio: aguardando leitura"}</small><small>{ai.carrier||o.courier?`Transportadora: ${ai.carrier||o.courier}`:"Transportadora: aguardando leitura"}</small><small>{ai.block||resident?.block?`Bloco: ${ai.block||resident?.block}`:"Bloco: aguardando"} • {ai.apt||resident?.apt?`Apto: ${ai.apt||resident?.apt}`:"Apto: aguardando"}</small><span className="badge">{o.identificationStatus==="reading"||running[o.id]?"IA lendo etiqueta...":"Pronto para identificação"}</span></div><div className="order-actions"><button className="primary" onClick={()=>onOpen(o)} disabled={o.identificationStatus==="reading"}>Identificar encomenda</button></div></div>})}</div>}</>
}

function IdentifyOrderModal({order,data,onClose,onConfirm}){
 const [selected,setSelected]=useState(order.residentId||order.aiLabel?.matchedResidentId||"");
 const ai=order.aiLabel||{};
 const ranked=data.residents.map(r=>({r,score:scoreResidentAgainstLabel(r,ai.ocrText||ai.recipientName||order.residentName||"")})).sort((a,b)=>b.score-a.score).slice(0,5);
 const current=data.residents.find(r=>r.id===selected);
 return <Modal title="Identificar encomenda" onClose={onClose}><div className="form">{order.photo&&<img className="identify-photo" src={order.photo} alt="Etiqueta"/>}<div className="ai-label-result"><b>Leitura da etiqueta</b><small>Destinatário: <strong>{ai.matchedResidentName||ai.recipientName||"Não identificado"}</strong></small><small>Bloco: <strong>{ai.block||"Não identificado"}</strong></small><small>Apartamento: <strong>{ai.apt||"Não identificado"}</strong></small><small>Rastreio: <strong>{ai.tracking||order.tracking||"Não identificado"}</strong></small><small>Transportadora: <strong>{ai.carrier||order.courier||"Não identificada"}</strong></small></div><label>Escolha o morador<select value={selected} onChange={e=>setSelected(e.target.value)}><option value="">Selecione...</option>{ranked.map(({r,score})=><option key={r.id} value={r.id}>{r.block}/{r.apt} · {r.name} — {Math.round(score*100)}%</option>)}</select></label>{current&&<div className="ai-confirm">✓ {current.name} — Bloco {current.block}, Apto {current.apt}</div>}<button className="primary wide" disabled={!selected} onClick={()=>onConfirm(order,selected)}>Confirmar identificação e enviar ao morador</button></div></Modal>
}

function EditNotification({order,resident,initialMessage,onClose,onSave}){
 const [message,setMessage]=useState(initialMessage||"");
 return <Modal title="Editar mensagem do aviso" onClose={onClose}><div className="form"><p className="hint">Encomenda {order.code} • {resident?.name||order.residentName||"Morador não vinculado"}. A alteração será guardada no The Door e usada quando abrir o WhatsApp.</p><label>Mensagem para o morador<textarea rows={7} value={message} onChange={e=>setMessage(e.target.value)} placeholder="Escreva a mensagem"/></label><button className="primary wide" onClick={()=>{if(!message.trim()){alert("A mensagem não pode ficar vazia.");return}onSave(message)}}>Salvar mensagem</button></div></Modal>
}

function CorrespondenceShareModal({correspondence,resident,onClose}){
 const defaultMessage=()=>{
  const name=resident?.name||correspondence.residentName||"morador";
  const type=correspondence.type||"correspondência";
  const sender=correspondence.sender?` Remetente: ${correspondence.sender}.`:"";
  const tracking=correspondence.tracking?` Código de rastreio: ${correspondence.tracking}.`:"";
  return `Olá, ${name}! Sua ${type.toLowerCase()} foi recebida na portaria e está disponível para retirada.${sender}${tracking} Por favor, compareça à portaria para retirar. Obrigado!`;
 };
 const [message,setMessage]=useState(defaultMessage);
 const send=async()=>{if(!message.trim()){alert("A mensagem não pode ficar vazia.");return}if(!resident?.phone){alert("O morador não possui telefone/WhatsApp cadastrado.");return}
  try{if(correspondence.photo&&navigator.share&&navigator.canShare){const blob=await (await fetch(correspondence.photo)).blob();const file=new File([blob],`The-Door-${correspondence.id}.jpg`,{type:blob.type||"image/jpeg"});if(navigator.canShare({files:[file]})){await navigator.share({files:[file],title:`The Door - ${correspondence.type||"Correspondência"}`,text:message});notify("Foto e mensagem preparadas para compartilhamento.");onClose();return;}}}catch(e){}
  if(!openWhatsAppChat(resident.phone,message)){window.open("https://wa.me/?text="+encodeURIComponent(message),"_blank");}onClose();};
 return <Modal title="Mensagem ao morador" onClose={onClose}><div className="form"><p className="hint">Edite a mensagem antes de abrir o WhatsApp. Se houver foto, ela será compartilhada junto com a mensagem.</p>{correspondence.photo&&<img className="identify-photo" src={correspondence.photo} alt="Foto da correspondência"/>}<label>Mensagem<textarea rows={9} value={message} onChange={e=>setMessage(e.target.value)} style={{width:"100%",boxSizing:"border-box"}}/></label><button className="primary wide" onClick={send}><Send/> Abrir WhatsApp</button></div></Modal>;
}

function CorrespondenceForm({data,onClose,onSave}){const [f,setF]=useState({residentId:data.residents[0]?.id||"",type:"Carta",sender:"",tracking:"",observations:"",photo:""});const fileRef=useRef(null);const choosePhoto=e=>{const file=e.target.files?.[0];if(!file)return;if(file.size>4*1024*1024){alert("Escolha uma foto de até 4 MB.");return}const reader=new FileReader();reader.onload=()=>setF(prev=>({...prev,photo:String(reader.result||"")}));reader.readAsDataURL(file);};return <Modal title="Nova correspondência" onClose={onClose}><div className="form"><label>Morador<select value={f.residentId} onChange={e=>setF({...f,residentId:e.target.value})}>{data.residents.map(r=><option value={r.id} key={r.id}>{r.name} — {r.block}/{r.apt}</option>)}</select></label><label>Tipo<select value={f.type} onChange={e=>setF({...f,type:e.target.value})}><option>Carta</option><option>Documento</option><option>AR</option><option>Correspondência registrada</option><option>Outro</option></select></label><label>Remetente<input value={f.sender} onChange={e=>setF({...f,sender:e.target.value})} placeholder="Nome ou empresa"/></label><label>Código de rastreio<input value={f.tracking} onChange={e=>setF({...f,tracking:e.target.value})} placeholder="Opcional"/></label><label>Foto da correspondência<input ref={fileRef} type="file" accept="image/*" capture="environment" onChange={choosePhoto}/></label>{f.photo&&<div className="ai-label-panel"><img src={f.photo} alt="Prévia da correspondência"/><div className="ai-label-status">Foto adicionada. Ela será enviada junto com o aviso ao morador.</div></div>}<label>Observações<textarea value={f.observations} onChange={e=>setF({...f,observations:e.target.value)}/></label><button className="primary wide" onClick={()=>{if(!f.residentId){alert("Cadastre um morador antes de registrar a correspondência.");return}onSave(f)}}>Cadastrar correspondência</button></div></Modal>}
function ResidentForm({resident,unit,onClose,onSave}){
 const [f,setF]=useState(()=>resident?{name:resident.name||"",phone:resident.phone||"",block:resident.block||"",street:resident.street||"",quadra:resident.quadra||"",apt:resident.apt||"",relationship:resident.relationship||""}:{name:"",phone:"",block:unit?.block||"",street:unit?.street||"",quadra:unit?.quadra||"",apt:unit?.apt||"",relationship:""});
 const labels={name:"Nome do morador",phone:"Telefone / WhatsApp",block:"Bloco",street:"Rua",quadra:"Quadra",apt:"Apartamento",relationship:"Parentesco / vínculo com o proprietário"};
 const placeholders={name:"Nome completo",phone:"DDD + telefone",block:"Ex.: B",street:"Ex.: Rua 02",quadra:"Ex.: Q1",apt:"Ex.: 204"};
 return <Modal title={resident?"Editar morador":"Cadastrar morador na unidade"} onClose={onClose}><div className="form">
 <p className="hint">{resident?"Altere os dados do morador. O parentesco/vínculo é usado apenas para organização interna e não é enviado automaticamente pelo WhatsApp.":"Preencha os dados do novo morador. O parentesco/vínculo ficará registrado no cadastro, mas não será incluído automaticamente nas mensagens."}</p>
 {Object.keys(f).map(k=>k!=="relationship"?<label key={k}>{labels[k]}<input value={f[k]} onChange={e=>setF({...f,[k]:e.target.value})} required={k==="name"} placeholder={placeholders[k]}/></label>:<label key={k}>{labels[k]}<select value={f.relationship} onChange={e=>setF({...f,relationship:e.target.value})}><option value="">Selecione</option><option>Proprietário</option><option>Inquilino</option><option>Esposa</option><option>Esposo</option><option>Filho</option><option>Filha</option><option>Pai</option><option>Mãe</option><option>Irmão</option><option>Irmã</option><option>Neto</option><option>Neta</option><option>Parente</option><option>Morador autorizado</option><option>Outro</option></select></label>)}
 <button className="primary wide" onClick={()=>{if(!f.name.trim()){alert("Informe o nome do morador.");return}onSave({...f,name:f.name.trim(),phone:f.phone.trim(),relationship:f.relationship.trim()})}}>{resident?"Salvar alterações":"Cadastrar morador"}</button></div></Modal>
}

function CourierForm({onClose,onSave}){const [f,setF]=useState({name:"",company:"",phone:"",doc:"",plate:""});return <Modal title="Cadastrar entregador" onClose={onClose}><div className="form">{Object.keys(f).map(k=><label key={k}>{({name:"Nome",company:"Empresa",phone:"Telefone",doc:"Documento",plate:"Placa"})[k]}<input value={f[k]} onChange={e=>setF({...f,[k]:e.target.value})}/></label>)}<button className="primary wide" onClick={()=>onSave(f)}>Salvar entregador</button></div></Modal>}
function Scanner({orders,onClose,onRead,title="Ler código de barras ou QR Code",receiveMode=false}){
 const [msg,setMsg]=useState(receiveMode?"Aponte a câmera para o código de barras da etiqueta.":"Escaneie o código The Door ou o rastreio da etiqueta.");
 const finished=useRef(false);
 useEffect(()=>{
  let active=true;
  let started=false;
  const formats=[Html5QrcodeSupportedFormats.QR_CODE,Html5QrcodeSupportedFormats.CODE_128,Html5QrcodeSupportedFormats.CODE_39,Html5QrcodeSupportedFormats.CODE_93,Html5QrcodeSupportedFormats.EAN_13,Html5QrcodeSupportedFormats.EAN_8,Html5QrcodeSupportedFormats.UPC_A,Html5QrcodeSupportedFormats.UPC_E,Html5QrcodeSupportedFormats.ITF,Html5QrcodeSupportedFormats.CODABAR];
  const reader=new Html5Qrcode("qr-reader",{formatsToSupport:formats,verbose:false});
  async function stopCamera(){
   try{if(started && reader.isScanning) await reader.stop();}catch{}
   try{reader.clear();}catch{}
   started=false;
  }
  reader.start({facingMode:"environment"},{fps:10,qrbox:(viewWidth,viewHeight)=>({width:Math.min(280,Math.max(180,viewWidth-32)),height:Math.min(160,Math.max(100,Math.floor(viewHeight/3)))}),aspectRatio:1.777},async text=>{
   if(!active||finished.current)return;
   finished.current=true;
   setMsg("Código lido. Finalizando câmera...");
   await stopCamera();
   if(!active)return;
   try{onRead(text)}catch{}
  },()=>{}).then(()=>{started=true;}).catch(()=>{
   if(active)setMsg("Não foi possível abrir a câmera. Confira a permissão do navegador e tente novamente.");
  });
  return ()=>{
   active=false;
   if(reader.isScanning){reader.stop().then(()=>{try{reader.clear()}catch{}}).catch(()=>{});}
   else {try{reader.clear()}catch{}}
  };
 },[]);
 return <Modal title={title} onClose={onClose}><div id="qr-reader" style={{width:"100%",minHeight:180}}></div><p className="scanmsg">{msg}</p><p className="hint">Compatível com QR Code e formatos comuns de barras. Alguns códigos logísticos podem exigir um leitor físico compatível.</p><button type="button" onClick={onClose}>Fechar leitor</button></Modal>
}
function PickupReceiptModal({orders,residents,onClose}){
 const [qrMap,setQrMap]=useState({});
 const [captionMap,setCaptionMap]=useState(()=>Object.fromEntries(orders.map(o=>[o.id,""])));
 useEffect(()=>{
  let alive=true;
  Promise.all(orders.map(async o=>[o.id,await QRCode.toDataURL(o.code,{width:360,margin:2,errorCorrectionLevel:"M"})])).then(entries=>{if(alive)setQrMap(Object.fromEntries(entries))}).catch(()=>{});
  return()=>{alive=false};
 },[orders]);
 const defaultCaptionFor=o=>{
  const r=residents.find(x=>x.id===o.residentId);
  const name=r?.name||o.residentName||"morador";
  return `Olá, ${name}! Informamos que a encomenda ${o.code} foi retirada na portaria e está sendo encaminhada ao morador. Este é o comprovante de retirada da encomenda. Obrigado!`;
 };
 const captionFor=o=>captionMap[o.id]||defaultCaptionFor(o);
 const shareOne=async o=>{
  const src=qrMap[o.id]; if(!src)return;
  const caption=captionFor(o);
  try{
   const blob=await (await fetch(src)).blob();
   const file=new File([blob],`The-Door-Comprovante-${o.code}.png`,{type:"image/png"});
   if(navigator.share&&navigator.canShare&&navigator.canShare({files:[file]})){await navigator.share({files:[file],title:`Comprovante de retirada - ${o.code}`,text:caption});return;}
  }catch(e){}
  const r=residents.find(x=>x.id===o.residentId);
  const url=whatsappUrl(r?.phone,caption);
  if(url)window.open(url,"_blank");
  else window.open("https://wa.me/?text="+encodeURIComponent(caption),"_blank");
 };
 const print=()=>{
  const blocks=orders.map(o=>{const r=residents.find(x=>x.id===o.residentId);const src=qrMap[o.id]||"";return `<section style="page-break-after:always;text-align:center;font-family:Arial,sans-serif;padding:30px"><h1 style="margin:0 0 8px">THE DOOR</h1><h2>Comprovante de retirada</h2><img src="${src}" style="width:280px;height:280px"/><h3>${o.code}</h3><p style="font-size:16px">${r?.name||o.residentName||"Morador"}</p><p>${r?`Bloco ${r.block||"—"} • Apto ${r.apt||"—"}`:o.address||""}</p><p style="max-width:520px;margin:20px auto;line-height:1.5">${captionFor(o)}</p><small>Retirada em ${o.pickedAt?new Date(o.pickedAt).toLocaleString("pt-BR"):new Date().toLocaleString("pt-BR")}</small></section>`}).join("");
  const w=window.open("","_blank"); if(!w)return; w.document.write(`<html><head><title>Comprovante The Door</title></head><body>${blocks}</body></html>`);w.document.close();w.focus();setTimeout(()=>w.print(),300);
 };
 return <Modal title={orders.length>1?"Comprovantes de retirada":"Comprovante de retirada"} onClose={onClose}>
  <div className="pickup-receipts">
   {orders.map(o=>{const r=residents.find(x=>x.id===o.residentId);return <div className="pickup-receipt" key={o.id}>
    <div className="pickup-receipt-brand"><img src={brandIcon} alt="The Door"/><div><b>THE DOOR</b><small>Comprovante de retirada</small></div></div>
    <div className="pickup-status"><CheckCircle2/> Retirada registrada</div>
    {qrMap[o.id]?<img className="pickup-qr" src={qrMap[o.id]} alt={`QR Code ${o.code}`}/>:<div className="pickup-qr-loading">Gerando QR Code...</div>}
    <strong className="pickup-code">{o.code}</strong>
    <p className="pickup-resident">{r?.name||o.residentName||"Morador"}</p>
    <p className="pickup-unit">{r?`Bloco ${r.block||"—"} • Apto ${r.apt||"—"}`:o.address||"Unidade não informada"}</p>
    {o.tracking&&<p className="pickup-tracking">Rastreio: {o.tracking}</p>}
    <div className="pickup-caption"><label style={{display:"block"}}><span style={{display:"block",marginBottom:6}}>Mensagem ao morador</span><textarea rows={6} value={captionFor(o)} onChange={e=>setCaptionMap(m=>({...m,[o.id]:e.target.value}))} style={{width:"100%",boxSizing:"border-box",background:"#111",color:"#eee",border:"1px solid #57452f",borderRadius:10,padding:10,font: "inherit",lineHeight:1.45}}/></label></div>
    <small className="pickup-date">Retirada em {o.pickedAt?new Date(o.pickedAt).toLocaleString("pt-BR"):new Date().toLocaleString("pt-BR")}</small>
    <div className="pickup-actions"><button className="primary wide" onClick={()=>shareOne(o)}><Send/> Compartilhar comprovante</button><button className="wide" onClick={()=>{const r=residents.find(x=>x.id===o.residentId);const url=whatsappUrl(r?.phone,captionFor(o));if(url)window.open(url,"_blank");else window.open("https://wa.me/?text="+encodeURIComponent(captionFor(o)),"_blank")}}><MessageSquare/> Enviar legenda pelo WhatsApp</button></div>
   </div>})}
   <button className="wide receipt-print" onClick={print}>Imprimir comprovante{orders.length>1?"s":""}</button>
  </div>
 </Modal>;
}

function QrModal({order,resident,onClose}){
 const [src,setSrc]=useState("");const [error,setError]=useState("");
 useEffect(()=>{let alive=true;QRCode.toDataURL(order.code,{width:320,margin:2,errorCorrectionLevel:"M"}).then(url=>{if(alive)setSrc(url)}).catch(()=>setError("Não foi possível gerar o QR Code."));return()=>{alive=false}},[order.code]);
 return <Modal title="QR Code da encomenda" onClose={onClose}><div className="qr-card">{src?<img src={src} alt={`QR Code ${order.code}`}/>:<p>{error||"Gerando QR Code..."}</p>}<strong>{order.code}</strong><p>{resident?.name||order.residentName||"Morador"}</p><p>{resident?`${resident.block} • Apto ${resident.apt}`:order.address}</p>{order.tracking&&<small>Rastreio: {order.tracking}</small>}<button className="primary wide" onClick={async()=>{if(!src)return;try{const blob=await (await fetch(src)).blob();const file=new File([blob],`The-Door-${order.code}.png`,{type:"image/png"});if(navigator.share&&navigator.canShare&&navigator.canShare({files:[file]})){await navigator.share({files:[file],title:`QR Code ${order.code}`,text:`QR Code da encomenda ${order.code}`});return}}catch(e){}const w=window.open("","_blank");if(w){w.document.write(`<title>QR ${order.code}</title><div style="font-family:Arial;text-align:center;padding:24px"><h2>The Door - ${order.code}</h2><img src="${src}" style="width:280px;height:280px"/><p>${resident?.name||order.residentName||"Morador"}</p><p>${resident?`${resident.block} • Apto ${resident.apt}`:order.address||""}</p></div>`);w.document.close();w.focus();setTimeout(()=>w.print(),300)}}}>Imprimir QR Code</button><button type="button" className="wide" onClick={async()=>{if(!src)return;const msg=`Olá, ${resident?.name||order.residentName||"morador"}! Segue o QR Code da sua encomenda ${order.code}. Apresente este código na portaria para retirada.`;try{const blob=await (await fetch(src)).blob();const file=new File([blob],`The-Door-${order.code}.png`,{type:"image/png"});if(navigator.share&&navigator.canShare&&navigator.canShare({files:[file]})){await navigator.share({files:[file],title:`QR Code ${order.code}`,text:msg});return}}catch(e){}const a=document.createElement("a");a.href=src;a.download=`The-Door-${order.code}.png`;a.click();const url=whatsappUrl(resident?.phone,msg);if(url)window.open(url,"_blank");else window.open("https://wa.me/?text="+encodeURIComponent(msg),"_blank")}}><Send/> Compartilhar QR Code</button><button type="button" className="wide" onClick={()=>{const msg=`Olá, ${resident?.name||order.residentName||"morador"}! Sua encomenda ${order.code} está disponível para retirada na portaria. Apresente o QR Code da encomenda no atendimento.`;const url=whatsappUrl(resident?.phone,msg);if(url){if(!openWhatsAppChat(resident?.phone,msg))window.open(url,"_blank")}else window.open("https://wa.me/?text="+encodeURIComponent(msg),"_blank")}}><Send/> Enviar aviso pelo WhatsApp</button></div></Modal>
}

function OwnerAdmin({user,onLogout}){
 const [condos,setCondos]=useState([]),[logs,setLogs]=useState([]),[users,setUsers]=useState([]);
 const [loading,setLoading]=useState(true),[error,setError]=useState(""),[editing,setEditing]=useState(null),[filter,setFilter]=useState("");
 const blank={nome:"",responsavel:"",email:"",telefone:"",endereco:"",status:"ativo",valor:"",periodo:"mensal",inicio:new Date().toISOString().slice(0,10),vencimento:"",teste:false,diasTeste:"",observacoes:""};
 const [form,setForm]=useState(blank);
 async function load(){
  setLoading(true);setError("");
  try{
   const [c,u,l]=await Promise.all([
    getDocs(collection(db,"condominios")),
    getDocs(collection(db,"usuarios")),
    getDocs(query(collection(db,"admin_logs"),orderBy("createdAt","desc"),limit(20)))
   ]);
   setCondos(c.docs.map(x=>({id:x.id,...x.data()})));
   setUsers(u.docs.map(x=>({id:x.id,...x.data()})));
   setLogs(l.docs.map(x=>({id:x.id,...x.data()})));
  }catch(e){setError("Não foi possível carregar a central. Confira as regras do Firestore. ("+(e.code||"erro")+")");}
  finally{setLoading(false)}
 }
 useEffect(()=>{load()},[]);
 async function audit(acao,condominioId,detalhe){
  await addDoc(collection(db,"admin_logs"),{acao,condominioId:condominioId||"",detalhe,autor:user.email||user.uid,autorUid:user.uid,createdAt:serverTimestamp()});
 }
 function openNew(){setEditing("new");setForm(blank)}
 function openEdit(c){setEditing(c.id);setForm({...blank,nome:c.nome||"",responsavel:c.responsavel||"",email:c.email||"",telefone:c.telefone||"",endereco:c.endereco||"",status:c.status||"ativo",valor:c.licenca?.valor??"",periodo:c.licenca?.periodo||"mensal",inicio:c.licenca?.inicio||"",vencimento:c.licenca?.vencimento||"",teste:!!c.licenca?.teste,diasTeste:c.licenca?.diasTeste||"",observacoes:c.observacoes||""})}
 async function save(e){
  e.preventDefault();
  if(!form.nome.trim()){setError("Informe o nome do condomínio.");return}
  const email=normalizeEmail(form.email);
  if(!email){setError("Informe o e-mail do responsável para liberar o acesso ao The Door.");return}
  const payload={nome:form.nome.trim(),responsavel:form.responsavel.trim(),email,telefone:form.telefone.trim(),endereco:form.endereco.trim(),status:form.status,observacoes:form.observacoes.trim(),licenca:{valor:Number(form.valor||0),periodo:form.periodo,inicio:form.inicio||"",vencimento:form.vencimento||"",teste:form.teste,diasTeste:Number(form.diasTeste||0),status:form.status==="suspenso"?"suspensa":(form.teste?"em_teste":(form.vencimento&&form.vencimento<new Date().toISOString().slice(0,10)?"expirada":"ativa"))},updatedAt:serverTimestamp()};
  try{
   let condoId=editing;
   if(editing==="new"){const ref=await addDoc(collection(db,"condominios"),{...payload,criadoPor:user.uid,createdAt:serverTimestamp()});condoId=ref.id;await audit("condominio_criado",ref.id,`Cadastro de ${payload.nome}`)}
   else {await updateDoc(doc(db,"condominios",editing),payload);await audit("condominio_atualizado",editing,`Atualização de ${payload.nome}`)}
   // Convite de acesso: a responsável cria a própria senha no primeiro acesso.
   await setDoc(doc(db,"convites",email),{email,nome:form.responsavel.trim(),condominioId:condoId,role:"admin",status:"pending",createdBy:user.uid,createdAt:serverTimestamp(),updatedAt:serverTimestamp()},{merge:true});
   await audit("convite_criado",condoId,`Acesso de ${email} vinculado ao condomínio`);
   setEditing(null);await load();
   setError("");
  }catch(e){setError("Falha ao salvar. Verifique as regras do Firestore. ("+(e.code||"erro")+")")}
 }
 async function changeStatus(c,status){
  try{const licenseStatus=status==="suspenso"?"suspensa":(c.licenca?.vencimento&&c.licenca.vencimento<today?"expirada":(c.licenca?.teste?"em_teste":"ativa"));
  await updateDoc(doc(db,"condominios",c.id),{status, "licenca.status":licenseStatus,updatedAt:serverTimestamp()});await audit(status==="suspenso"?"licenca_suspensa":"licenca_reativada",c.id,`${c.nome}: ${status}`);await load()}
  catch(e){setError("Não foi possível alterar o status. ("+(e.code||"erro")+")")}
 }
 const today=new Date().toISOString().slice(0,10);
 const active=condos.filter(c=>c.status==="ativo"&&(!c.licenca?.vencimento||c.licenca.vencimento>=today)).length;
 const expired=condos.filter(c=>c.licenca?.vencimento&&c.licenca.vencimento<today).length;
 const due=condos.filter(c=>c.licenca?.vencimento&&c.licenca.vencimento>=today&&c.licenca.vencimento<=new Date(Date.now()+30*86400000).toISOString().slice(0,10)).length;
 const shown=condos.filter(c=>`${c.nome||""} ${c.responsavel||""} ${c.email||""}`.toLowerCase().includes(filter.toLowerCase()));
 return <div className="app admin-app">
  <header><div className="brand"><img className="brand-logo" src={brandIcon} alt="Logo The Door"/><div><b>THE DOOR · ADMIN</b><small>Painel do proprietário</small></div></div><div className="header-actions"><span className="user-email">{user.email||"Proprietário"}</span><button onClick={onLogout}><LogOut/> Sair</button></div></header>
  <main>
   <div className="hero"><div><span className="eyebrow">CENTRAL DA PLATAFORMA</span><h1>Administração The Door</h1><p>Gerencie condomínios, licenças e cobranças em um só lugar.</p></div><div className="hero-buttons"><button onClick={load}><RefreshCw/> Atualizar</button><button className="primary" onClick={openNew}><Plus/> Novo condomínio</button></div></div>
   {error&&<p className="admin-error">{error}</p>}
   <section className="admin-overview">
    <div className="admin-section-head"><div><span className="eyebrow">VISÃO GERAL</span><h2>Operação da plataforma</h2><p>Acompanhe condomínios, licenças, acessos e receita em um único painel.</p></div></div>
    <div className="stats admin-stats">
     <Stat icon={<Building2/>} label="Condomínios cadastrados" value={condos.length}/>
     <Stat icon={<ShieldCheck/>} label="Licenças ativas" value={active}/>
     <Stat icon={<CalendarDays/>} label="Vencem em até 30 dias" value={due}/>
     <Stat icon={<Clock/>} label="Licenças vencidas" value={expired}/>
     <Stat icon={<Users/>} label="Usuários vinculados" value={users.length}/>
     <Stat icon={<Wallet/>} label="Receita mensal cadastrada" value={"R$ "+condos.filter(c=>c.status==="ativo").reduce((a,c)=>a+Number(c.licenca?.valor||0),0).toLocaleString("pt-BR",{minimumFractionDigits:2})}/>
    </div>
   </section>
   <SectionTitle icon={<Building2/>} title="Condomínios e licenças"/>
   <div className="toolbar admin-toolbar"><div className="search"><Search/><input value={filter} onChange={e=>setFilter(e.target.value)} placeholder="Buscar condomínio, responsável ou e-mail..."/></div><button className="primary" onClick={openNew}><Plus/> Novo condomínio</button></div>
   {!loading&&<div className="admin-list-meta"><span>{shown.length} condomínio(s) exibido(s)</span><span>{active} ativo(s) · {expired} vencido(s)</span></div>}
   {loading?<div className="empty">Carregando dados administrativos...</div>:shown.length===0?<div className="empty">Nenhum condomínio cadastrado.</div>:<div className="cards admin-condo-list">{shown.map(c=><div className="card admin-condo" key={c.id}>
    <div className="admin-condo-top"><div><b>{c.nome||"Condomínio sem nome"}</b><small>{c.responsavel||"Responsável não informado"} · {c.endereco||"Endereço não informado"}</small></div><span className={"badge "+(c.status==="ativo"?"done":"")}>{c.status||"sem status"}</span></div>
    <div className="admin-meta"><span>Valor: <b>R$ {Number(c.licenca?.valor||0).toLocaleString("pt-BR",{minimumFractionDigits:2})}</b></span><span>Cobrança: <b>{c.licenca?.periodo||"não definida"}</b></span><span>Vencimento: <b>{c.licenca?.vencimento?new Date(c.licenca.vencimento+"T12:00:00").toLocaleDateString("pt-BR"):"não definido"}</b></span><span>Teste: <b>{c.licenca?.teste?"Sim":"Não"}</b></span></div>
    <div className="admin-actions"><button onClick={()=>openEdit(c)}><Pencil/> Editar / licença</button>{c.status==="suspenso"?<button className="primary" onClick={()=>changeStatus(c,"ativo")}>Reativar</button>:<button className="danger-action" onClick={()=>changeStatus(c,"suspenso")}>Suspender acesso</button>}</div>
   </div>)}</div>}
   <SectionTitle icon={<Users/>} title="Acessos dos condomínios"/>
   <div className="card"><small>Acompanhe os acessos vinculados a cada condomínio. Novos administradores recebem convite e concluem o próprio cadastro de acesso.</small>
    {users.slice(0,12).map(u=><div className="admin-user-row" key={u.id}><b>{u.nome||u.email||u.id}</b><small>{u.email||u.id} · {u.role||"usuário"} · {u.status||"sem status"} · Condomínio: {u.condominioId||"—"}</small></div>)}
   </div>
   <SectionTitle icon={<History/>} title="Registro de atividades administrativas"/>
   <div className="card">{logs.length===0?<small>Nenhuma atividade registrada ainda.</small>:logs.map(l=><div className="admin-user-row" key={l.id}><b>{String(l.acao||"Atividade").replaceAll("_"," ")}</b><small>{l.detalhe||""} · {l.autor||""} · {l.createdAt?.toDate?l.createdAt.toDate().toLocaleString("pt-BR"):"agora"}</small></div>)}</div>
  </main>
  {editing!==null&&<div className="overlay"><form className="modal admin-form" onSubmit={save}><div className="modalhead"><h3>{editing==="new"?"Cadastrar condomínio":"Editar condomínio e licença"}</h3><button type="button" onClick={()=>setEditing(null)}>×</button></div>
   <div className="form">
    <label>Nome do condomínio<input required value={form.nome} onChange={e=>setForm({...form,nome:e.target.value})}/></label>
    <label>Responsável / síndico<input value={form.responsavel} onChange={e=>setForm({...form,responsavel:e.target.value})}/></label>
    <label>E-mail de contato<input type="email" value={form.email} onChange={e=>setForm({...form,email:e.target.value})}/></label>
    <label>Telefone<input value={form.telefone} onChange={e=>setForm({...form,telefone:e.target.value})}/></label>
    <label>Endereço<input value={form.endereco} onChange={e=>setForm({...form,endereco:e.target.value})}/></label>
    <div className="admin-form-grid"><label>Valor negociado (R$)<input type="number" min="0" step="0.01" value={form.valor} onChange={e=>setForm({...form,valor:e.target.value})}/></label><label>Periodicidade<select value={form.periodo} onChange={e=>setForm({...form,periodo:e.target.value})}><option value="mensal">Mensal</option><option value="trimestral">Trimestral</option><option value="semestral">Semestral</option><option value="anual">Anual</option><option value="personalizado">Personalizado</option></select></label></div>
    <div className="admin-form-grid"><label>Início da licença<input type="date" value={form.inicio} onChange={e=>setForm({...form,inicio:e.target.value})}/></label><label>Vencimento<input type="date" value={form.vencimento} onChange={e=>setForm({...form,vencimento:e.target.value})}/></label></div>
    <label className="admin-check"><input type="checkbox" checked={form.teste} onChange={e=>setForm({...form,teste:e.target.checked})}/> Ativar período de teste</label>
    {form.teste&&<label>Duração do teste (dias)<input type="number" min="1" value={form.diasTeste} onChange={e=>setForm({...form,diasTeste:e.target.value})}/></label>}
    <label>Status do condomínio<select value={form.status} onChange={e=>setForm({...form,status:e.target.value})}><option value="ativo">Ativo</option><option value="suspenso">Suspenso</option><option value="inativo">Inativo</option></select></label>
    <label>Observações<textarea value={form.observacoes} onChange={e=>setForm({...form,observacoes:e.target.value})}/></label>
    <button className="primary wide" type="submit">Salvar condomínio e licença</button>
   </div>
  </form></div>}
 </div>
}

function App(){
 const [user,setUser]=useState(null); const [checking,setChecking]=useState(true); const [profile,setProfile]=useState(null); const [profileLoading,setProfileLoading]=useState(false);
 useEffect(()=>onAuthStateChanged(auth,u=>{setUser(u);setChecking(false);setProfile(null)}),[]);
 useEffect(()=>{let live=true;if(!user){setProfile(null);return}setProfileLoading(true);getDoc(doc(db,"usuarios",user.uid)).then(s=>{if(live)setProfile(s.exists()?s.data():null)}).catch(()=>{if(live)setProfile(null)}).finally(()=>{if(live)setProfileLoading(false)});return()=>{live=false}},[user?.uid]);
 if(checking|| (user&&profileLoading)) return <div className="auth-screen"><div className="auth-card"><img src={brandIcon} alt="The Door"/><h1>The Door</h1><p>Verificando sua sessão...</p></div></div>;
 if(!user) return <LoginScreen/>;
 if(profile?.role==="owner"&&profile?.status==="active")return <OwnerAdmin user={user} onLogout={()=>signOut(auth)}/>;
 return <AppContent user={user} onLogout={()=>signOut(auth)}/>;
}
function LoginScreen(){
 const [mode,setMode]=useState("login"); const [email,setEmail]=useState(""); const [password,setPassword]=useState(""); const [busy,setBusy]=useState(false); const [error,setError]=useState(""); const [embedded,setEmbedded]=useState(false);
 useEffect(()=>{
  const ua=navigator.userAgent||"";
  const inApp=/(WhatsApp|FBAN|FBAV|Instagram|Messenger|Line\/|TikTok|GSA\/)/i.test(ua);
  const ios=/(iPhone|iPad|iPod)/i.test(ua);
  setEmbedded(inApp && ios);
 },[]);
 async function run(action){setBusy(true);setError("");try{await action()}catch(e){const map={"auth/invalid-credential":"E-mail ou senha incorretos.","auth/user-not-found":"Conta não encontrada.","auth/wrong-password":"E-mail ou senha incorretos.","auth/email-already-in-use":"Este e-mail já possui cadastro.","auth/weak-password":"A senha deve ter pelo menos 6 caracteres.","auth/popup-closed-by-user":"A janela de login foi fechada.","auth/popup-blocked":"O navegador bloqueou a janela de login. Abra o The Door no Safari ou Chrome e tente novamente.","auth/web-storage-unsupported":"O navegador não permitiu o armazenamento necessário para o login. Abra o The Door no Safari ou Chrome.","auth/unauthorized-domain":"Este domínio não está autorizado no Firebase.","auth/operation-not-allowed":"Ative este método de login no Firebase Authentication.","invite-required":"Este e-mail ainda não foi liberado pelo administrador do The Door. Peça o convite ao proprietário.","invite-invalid":"Este convite não está mais válido. Peça um novo convite ao proprietário."};setError(map[e.code]||`Não foi possível entrar. (${e.code||"erro"})`)}finally{setBusy(false)}}
 function openExternal(){
  try{window.open(window.location.href,"_blank","noopener,noreferrer");}catch{}
  setError("Se esta tela continuar no WhatsApp, toque em ⋯ e escolha “Abrir no navegador” ou copie o endereço e abra no Safari.");
 }
 return <div className="auth-screen"><div className="auth-card"><img src={brandIcon} alt="Logo The Door"/><div className="auth-eyebrow">LOGÍSTICA DE ENCOMENDAS</div><h1>Bem-vindo ao The Door</h1><p className="auth-subtitle">Entre para acessar a gestão de encomendas do seu condomínio.</p>{embedded&&<div className="auth-browser-warning" role="alert"><strong>Abra o The Door no Safari</strong><span>O navegador do WhatsApp pode bloquear o login do Google. Toque em <b>⋯</b> e escolha <b>“Abrir no navegador”</b>.</span><button type="button" className="secondary wide" onClick={openExternal}>Tentar abrir no navegador</button></div>}<button className="google-button" disabled={busy||embedded} onClick={()=>run(async()=>{const result=await signInWithPopup(auth,new GoogleAuthProvider());const provisioned=await provisionInvitedUser(result.user);if(!provisioned){await signOut(auth);const err=new Error("invite-required");err.code="invite-required";throw err}})}><span className="google-g">G</span> Continuar com Google</button><div className="auth-separator"><span>ou use seu e-mail</span></div><form className="auth-form" onSubmit={e=>{e.preventDefault();run(async()=>{if(mode!=="register"){await signInWithEmailAndPassword(auth,normalizeEmail(email),password);return}const credential=await createUserWithEmailAndPassword(auth,normalizeEmail(email),password);const provisioned=await provisionInvitedUser(credential.user);if(!provisioned){await credential.user.delete();const err=new Error("invite-required");err.code="invite-required";throw err}})}}><label>E-mail<input type="email" autoComplete="email" value={email} onChange={e=>setEmail(e.target.value)} required placeholder="voce@exemplo.com"/></label><label>Senha<input type="password" autoComplete={mode==="register"?"new-password":"current-password"} value={password} onChange={e=>setPassword(e.target.value)} required minLength={6} placeholder="Mínimo de 6 caracteres"/></label>{error&&<p className="auth-error" role="alert">{error}</p>}<button className="primary wide" disabled={busy}>{busy?"Aguarde...":mode==="register"?"Criar conta":"Entrar"}</button></form><button className="auth-switch" onClick={()=>{setMode(mode==="register"?"login":"register");setError("")}}>{mode==="register"?"Já tem uma conta? Entrar":"Primeiro acesso? Criar conta com e-mail"}</button><p className="auth-footnote">Os dados do condomínio são sincronizados pela nuvem. O acesso precisa ser liberado pelo administrador do The Door.</p></div></div>
}
createRoot(document.getElementById("root")).render(<App/>);
