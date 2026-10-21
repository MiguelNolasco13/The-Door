import React,{useEffect,useMemo,useRef,useState} from "react";
import {createRoot} from "react-dom/client";
import { onAuthStateChanged, signInWithPopup, GoogleAuthProvider, signInWithEmailAndPassword, createUserWithEmailAndPassword, signOut } from "firebase/auth";
import { auth } from "./firebase.js";
import QRCode from "qrcode";
import {Html5Qrcode,Html5QrcodeSupportedFormats} from "html5-qrcode";
import {PackagePlus,ScanLine,Users,History,Truck,MapPin,Trash2,Send,Search,Home,LogOut,Plus,CheckCircle2,Clock,ChevronRight,Pencil,UserPlus,MessageSquare} from "lucide-react";
import "./styles.css";
import brandIcon from "./the-door-icon.png";

const KEY_PREFIX="the-door-v1-user-";
const initial={
 residents:[
  {id:"m1",name:"João da Silva",phone:"21999990001",block:"B",street:"Rua 02",quadra:"Q1",apt:"204"},
  {id:"m2",name:"Maria Oliveira",phone:"21988880002",block:"A",street:"Rua 01",quadra:"Q1",apt:"101"}
 ],
 couriers:[], orders:[]
};
function load(userId){
 try{
  const own=localStorage.getItem(KEY_PREFIX+userId);
  if(own) return JSON.parse(own)||initial;
  // Migra os dados antigos deste navegador para a primeira conta que entrar.
  const legacy=localStorage.getItem("the-door-v1");
  if(legacy){localStorage.setItem(KEY_PREFIX+userId,legacy);localStorage.removeItem("the-door-v1");return JSON.parse(legacy)||initial;}
  return initial;
 }catch{return initial}
}
function uid(p="id"){return p+"-"+Date.now()+"-"+Math.random().toString(36).slice(2,7)}
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
function AppContent({user,onLogout}){
 const [data,setData]=useState(()=>load(user.uid)); const [tab,setTab]=useState("home"); const [query,setQuery]=useState("");
 const [showAdd,setShowAdd]=useState(false); const [showResident,setShowResident]=useState(false); const [residentEdit,setResidentEdit]=useState(null); const [residentUnit,setResidentUnit]=useState(null); const [showCourier,setShowCourier]=useState(false); const [scan,setScan]=useState(false); const [qrOrder,setQrOrder]=useState(null);
 const [notice,setNotice]=useState("");
 useEffect(()=>localStorage.setItem(KEY_PREFIX+user.uid,JSON.stringify(data)),[data,user.uid]);
 const orders=data.orders;
 const pending=orders.filter(o=>o.status==="Pendente");
 const notificationQueue=orders.filter(o=>o.status==="Pendente"&&o.notificationStatus!=="sent");
 const filtered=useMemo(()=>orders.filter(o=>JSON.stringify(o).toLowerCase().includes(query.toLowerCase())),[orders,query]);
 function notify(x){setNotice(x);setTimeout(()=>setNotice(""),2500)}
 function notificationMessage(order, kind="arrival"){
  const r=data.residents.find(x=>x.id===order.residentId);
  if(!r)return null;
  if(kind==="pickup")return `Olá, ${r.name}! Confirmamos que sua encomenda ${order.code} foi retirada na portaria. Obrigado!`;
  return `Olá, ${r.name}! Sua encomenda ${order.code} está disponível para retirada na portaria. Apresente o QR Code da encomenda ou informe o código ${order.tracking||order.code} ao atendente. Obrigado!`;
 }
 function addOrder(o){
  const {notificationChoice="later",...orderFields}=o;
  const newOrder={...orderFields,id:uid("enc"),code:"TD-"+Math.random().toString(36).slice(2,8).toUpperCase(),status:"Pendente",receivedAt:new Date().toISOString(),notificationStatus:"pending"};
  setData(d=>({...d,orders:[newOrder,...d.orders]}));
  setShowAdd(false);
  if(notificationChoice==="now"){
   const r=data.residents.find(x=>x.id===newOrder.residentId);
   const msg=notificationMessage(newOrder);
   if(!r){notify("Encomenda salva na fila. Vincule um morador para enviar o aviso.");setTab("notifications");return}
   if(!phoneForWhatsApp(r.phone)||phoneForWhatsApp(r.phone).length<12){notify("Encomenda salva na fila. Confira o telefone do morador com DDD e código do país.");setTab("notifications");return}
   if(openWhatsAppChat(r.phone,msg)) notify("WhatsApp aberto. Depois de tocar em Enviar, volte ao The Door e marque o aviso como enviado na Central de Notificações.");
   else notify("Encomenda salva na fila. O navegador bloqueou a janela; abra o aviso pela Central de Notificações.");
  }else notify("Encomenda cadastrada. O aviso ficou guardado na Central de Notificações.");
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
 function removeOrder(id){if(confirm("Excluir esta encomenda?"))setData(d=>({...d,orders:d.orders.filter(o=>o.id!==id)}))}
 function deliver(id){
  const o=orders.find(x=>x.id===id);
  if(!o)return;
  const picked={...o,status:"Retirada",pickedAt:new Date().toISOString(),pickupMethod:"manual"};
  setData(d=>({...d,orders:d.orders.map(x=>x.id===id?picked:x)}));
  const r=data.residents.find(x=>x.id===o.residentId);
  if(!r){notify(o.notificationStatus!=="sent"?"Retirada registrada. O aviso pendente foi removido da fila; não há morador vinculado para a confirmação.":"Retirada registrada. Não há morador vinculado para enviar a confirmação.");return}
  const msg=`Olá, ${r.name}! Confirmamos que sua encomenda ${o.code} foi retirada na portaria. Obrigado!`;
  if(!phoneForWhatsApp(r.phone)||phoneForWhatsApp(r.phone).length<12){notify("Retirada registrada. O aviso pendente foi removido da fila. Confira o telefone do morador com DDD.");return}
  if(openWhatsAppChat(r.phone,msg))notify("Retirada registrada. O aviso pendente saiu da fila. Confira a conversa do WhatsApp e toque em Enviar.");
  else notify("Retirada registrada. O aviso pendente saiu da fila. Use a confirmação pelo WhatsApp no Histórico.");
 }
 function scannedCheckout(value){
  const clean=value.trim();
  const o=orders.find(x=>x.status==="Pendente"&&(String(x.code).toLowerCase()===clean.toLowerCase()||String(x.tracking||"").toLowerCase()===clean.toLowerCase()));
  if(!o){notify("Código não encontrado entre as encomendas pendentes.");return}
  const method=String(o.code).toLowerCase()===clean.toLowerCase()?"QR Code":"código de barras";
  setData(d=>({...d,orders:d.orders.map(x=>x.id===o.id?{...x,status:"Retirada",pickedAt:new Date().toISOString(),pickupMethod:method}:x)}));
  setScan(false);setQrOrder(null);
  const r=data.residents.find(x=>x.id===o.residentId);
  if(!r){notify(o.notificationStatus!=="sent"?"Retirada registrada. O aviso pendente foi removido da fila; morador não vinculado para confirmação.":"Retirada registrada, mas não há morador vinculado para enviar a confirmação.");return}
  const msg=`Olá, ${r.name}! Confirmamos que sua encomenda ${o.code} foi retirada na portaria por ${method==="QR Code"?"meio do QR Code":"meio do código de barras"}. Obrigado!`;
  if(!phoneForWhatsApp(r.phone)||phoneForWhatsApp(r.phone).length<12){notify("Retirada registrada. O aviso pendente foi removido da fila. Confira o telefone do morador com DDD.");return}
  if(openWhatsAppChat(r.phone,msg)) notify("Retirada registrada. O aviso pendente saiu da fila. Confira a conversa do WhatsApp e toque em Enviar.");
  else notify("Retirada registrada. O aviso pendente saiu da fila. Use a confirmação pelo WhatsApp no Histórico.");
 }
 function openWhatsApp(phone,msg){if(!whatsappUrl(phone,msg)){notify("Confira o telefone do morador com DDD e código do país antes de enviar pelo WhatsApp.");return}if(!openWhatsAppChat(phone,msg))notify("O navegador bloqueou a nova janela. Permita pop-ups para o The Door e tente novamente.")}
  function sendWhatsApp(o){const r=data.residents.find(x=>x.id===o.residentId);if(!r){notify("Cadastre ou vincule um morador para enviar a mensagem.");return}const msg=`Olá, ${r.name}! Sua encomenda ${o.code} está disponível para retirada na portaria. Apresente o QR Code desta encomenda ou informe o código ${o.tracking||o.code} ao atendente. Obrigado!`;openWhatsApp(r.phone,msg)}
  function sendPickupConfirmation(o,method){const r=data.residents.find(x=>x.id===o.residentId);if(!r){notify("Retirada registrada, mas não foi possível enviar a mensagem: morador sem telefone vinculado.");return}const msg=`Olá, ${r.name}! Confirmamos que sua encomenda ${o.code} foi retirada na portaria por ${method==="QR Code"?"meio do QR Code":"meio do código de barras"}. Obrigado!`;openWhatsApp(r.phone,msg)}
 return <div className="app">
  <header><div className="brand"><img className="brand-logo" src={brandIcon} alt="Logo The Door"/><div><b>THE DOOR</b><small>Logística de encomendas para condomínios</small></div></div><div className="header-actions"><span className="user-email">{user.email||user.displayName||"Usuário"}</span><button onClick={()=>setScan(true)}><ScanLine/> Ler código</button><button onClick={onLogout}><LogOut/> Sair</button></div></header>
  <main>
   {tab==="home"&&<Dashboard pending={pending} orders={orders} onAdd={()=>setShowAdd(true)} onScan={()=>setScan(true)} onWhats={sendWhatsApp} onDeliver={deliver} onDelete={removeOrder} onShowQr={setQrOrder}/>}
   {tab==="orders"&&<><SectionTitle icon={<History/>} title="Encomendas"/><div className="toolbar"><div className="search"><Search/><input value={query} onChange={e=>setQuery(e.target.value)} placeholder="Buscar código, morador, apartamento..."/></div><button className="primary" onClick={()=>setShowAdd(true)}><Plus/> Nova encomenda</button></div><OrderList orders={filtered} data={data} onWhats={sendWhatsApp} onDeliver={deliver} onDelete={removeOrder} onShowQr={setQrOrder} onConfirmPickup={sendPickupConfirmation}/></>}
   {tab==="residents"&&<><SectionTitle icon={<Users/>} title="Moradores por unidade"/><div className="toolbar"><div className="search"><Search/><input value={query} onChange={e=>setQuery(e.target.value)} placeholder="Buscar nome, telefone, bloco ou apartamento..."/></div><button className="primary" onClick={()=>{setResidentEdit(null);setResidentUnit(null);setShowResident(true)}}><Plus/> Cadastrar morador</button></div><div className="unit-list">{Object.entries(data.residents.filter(r=>JSON.stringify(r).toLowerCase().includes(query.toLowerCase())).reduce((groups,r)=>{const key=[r.block,r.street,r.quadra,r.apt].map(v=>(v||"").trim().toLowerCase()).join("|");if(!groups[key])groups[key]={key,block:r.block,street:r.street,quadra:r.quadra,apt:r.apt,residents:[]};groups[key].residents.push(r);return groups;},{})).sort((a,b)=>`${a[1].street} ${a[1].quadra} ${a[1].block} ${a[1].apt}`.localeCompare(`${b[1].street} ${b[1].quadra} ${b[1].block} ${b[1].apt}`,"pt-BR")).map(([key,u])=><div className="card unit-card" key={key}><div className="unit-heading"><div className="unit-icon"><MapPin/></div><div className="unit-title"><b>Unidade {u.apt||"não informada"}</b><small>{[u.block&&`Bloco ${u.block}`,u.street,u.quadra&&`Quadra ${u.quadra}`].filter(Boolean).join(" • ")||"Endereço não informado"}</small><small>{u.residents.length} morador(es) cadastrado(s)</small></div><button className="unit-add" onClick={()=>{setResidentEdit(null);setResidentUnit(u);setShowResident(true)}}><UserPlus/> Adicionar</button></div><div className="unit-residents">{u.residents.map(r=><div className="resident-row" key={r.id}><div className="resident-info"><b>{r.name}</b><small>WhatsApp: {r.phone||"Não informado"}</small></div><button className="edit-resident" title="Editar morador" onClick={()=>{setResidentEdit(r);setResidentUnit(null);setShowResident(true)}}><Pencil/> Editar</button></div>)}</div></div>)}</div>{data.residents.length===0&&<div className="empty">Nenhum morador cadastrado. Use “Cadastrar morador” para começar.</div>}</>}
   {tab==="notifications"&&<><SectionTitle icon={<MessageSquare/>} title="Central de Notificações"/><div className="notification-intro card"><b>{notificationQueue.length} aviso(s) pendente(s)</b><small>Abra cada conversa, envie a mensagem no WhatsApp e depois marque o aviso como enviado. Encomendas retiradas saem automaticamente desta fila.</small></div>{notificationQueue.length===0?<div className="empty">Nenhum aviso pendente. Os novos avisos cadastrados para envio posterior aparecerão aqui.</div>:<div className="cards">{notificationQueue.map(o=>{const r=data.residents.find(x=>x.id===o.residentId);return <div className="card notification-card" key={o.id}><div className="order-main"><div className="code">{o.code}</div><b>{r?.name||o.residentName||"Morador não vinculado"}</b><small>{r?`Bloco ${r.block||"—"} • Apto ${r.apt||"—"}`:o.address||"Unidade não informada"}</small><small>Recebida: {new Date(o.receivedAt).toLocaleString("pt-BR")}</small><span className="badge">Aviso pendente</span></div><div className="notification-actions"><button className="primary" onClick={()=>openQueuedNotification(o)}><Send size={16}/> Abrir WhatsApp</button><button onClick={()=>{if(confirm("Confirma que a mensagem foi enviada pelo WhatsApp?"))markNotificationSent(o.id)}}><CheckCircle2 size={16}/> Marcar enviada</button></div></div>})}</div>}</>}
   {tab==="couriers"&&<><SectionTitle icon={<Truck/>} title="Entregadores"/><div className="toolbar"><button className="primary" onClick={()=>setShowCourier(true)}><Plus/> Cadastrar entregador</button></div><div className="cards">{data.couriers.map(c=><div className="card" key={c.id}><b>{c.name}</b><small>{c.company||"Sem empresa"} • {c.phone||"Sem telefone"}</small><small>Documento: {c.doc||"—"} • Placa: {c.plate||"—"}</small></div>)}</div></>}
   {tab==="history"&&<><SectionTitle icon={<History/>} title="Histórico de retiradas"/><OrderList orders={orders.filter(o=>o.status==="Retirada")} data={data} onWhats={sendWhatsApp} onDeliver={deliver} onDelete={removeOrder} onShowQr={setQrOrder} onConfirmPickup={sendPickupConfirmation}/></>}
  </main>
  <nav>{[["home","Início",Home],["orders","Encomendas",History],["notifications","Avisos",MessageSquare],["residents","Moradores",Users],["couriers","Entregadores",Truck],["history","Histórico",Clock]].map(([k,l,I])=><button className={tab===k?"active":""} onClick={()=>setTab(k)} key={k}><I/><span>{l}</span></button>)}</nav>
  {showAdd&&<AddOrder data={data} onClose={()=>setShowAdd(false)} onSave={addOrder}/>}
  {showResident&&<ResidentForm resident={residentEdit} unit={residentUnit} onClose={()=>{setShowResident(false);setResidentEdit(null);setResidentUnit(null)}} onSave={r=>{setData(d=>({...d,residents:residentEdit?d.residents.map(old=>old.id===residentEdit.id?{...old,...r,id:old.id}:old):[...d.residents,{...r,id:uid("mor")}] }));setShowResident(false);setResidentEdit(null);setResidentUnit(null);notify(residentEdit?"Morador atualizado com sucesso.":"Morador cadastrado na unidade.")}}/>}
  {showCourier&&<CourierForm onClose={()=>setShowCourier(false)} onSave={c=>{setData(d=>({...d,couriers:[...d.couriers,{...c,id:uid("ent")}] }));setShowCourier(false)}}/>}
  {scan&&<Scanner orders={orders} onClose={()=>setScan(false)} onRead={scannedCheckout}/>}
  {qrOrder&&<QrModal order={qrOrder} resident={data.residents.find(r=>r.id===qrOrder.residentId)} onClose={()=>setQrOrder(null)}/> }
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
function OrderList({orders,data,onWhats,onDeliver,onDelete,onShowQr,onConfirmPickup}){
 if(!orders.length)return <div className="empty">Nenhuma encomenda encontrada.</div>;
 return <div className="cards">{orders.map(o=><OrderCard key={o.id} o={o} data={data} onWhats={onWhats} onDeliver={onDeliver} onDelete={onDelete} onShowQr={onShowQr} onConfirmPickup={onConfirmPickup}/>)}</div>
}
function OrderCard({o,data,onWhats,onDeliver,onDelete,onShowQr,onConfirmPickup}){
 const resident=data?.residents?.find(r=>r.id===o.residentId); return <div className="card order">{o.photo&&<img className="order-photo" src={o.photo} alt="Foto da encomenda" style={{width:88,height:88,objectFit:"cover",borderRadius:10,flexShrink:0}}/>}<div className="order-main"><div className="code">Código The Door: {o.code}</div>{o.tracking&&<small>Código de barras/rastreio: {o.tracking}</small>}<b>{resident?.name||o.residentName||"Morador"}</b><small>{resident?`${resident.block} • Apto ${resident.apt} • ${resident.street} • ${resident.quadra}`:o.address}</small><small>Recebida: {new Date(o.receivedAt).toLocaleString("pt-BR")}</small><span className={o.status==="Retirada"?"badge done":"badge"}>{o.status}</span></div><div className="order-actions">{onShowQr&&<button title="Ver QR Code próprio" onClick={()=>onShowQr(o)}><ScanLine/></button>}{o.status==="Pendente"&&<button title="WhatsApp" onClick={()=>onWhats(o)}><Send/></button>}{o.status==="Retirada"&&onConfirmPickup&&<button title="Enviar confirmação de retirada pelo WhatsApp" onClick={()=>onConfirmPickup(o,o.pickupMethod||"código de barras")}><Send/></button>}{o.status==="Pendente"&&<button className="ok" title="Dar baixa manual" onClick={()=>onDeliver(o.id)}><CheckCircle2/></button>}<button className="danger" title="Excluir" onClick={()=>onDelete(o.id)}><Trash2/></button></div></div>
}
function Modal({title,children,onClose}){return <div className="overlay"><div className="modal"><div className="modalhead"><h3>{title}</h3><button onClick={onClose}>×</button></div>{children}</div></div>}
function AddOrder({data,onClose,onSave}){
 const [f,setF]=useState({residentId:data.residents[0]?.id||"",courier:"",tracking:"",description:"",observations:"",notificationChoice:"later"}); const [readBarcode,setReadBarcode]=useState(false); const [photo,setPhoto]=useState(""); const [photoError,setPhotoError]=useState(""); const r=data.residents.find(x=>x.id===f.residentId);
 async function handlePhoto(file){setPhotoError("");if(!file)return;try{const dataUrl=await new Promise((resolve,reject)=>{const reader=new FileReader();reader.onload=()=>resolve(reader.result);reader.onerror=reject;reader.readAsDataURL(file)});const img=await new Promise((resolve,reject)=>{const image=new Image();image.onload=()=>resolve(image);image.onerror=reject;image.src=dataUrl});const max=1280;const scale=Math.min(1,max/Math.max(img.width,img.height));const canvas=document.createElement("canvas");canvas.width=Math.round(img.width*scale);canvas.height=Math.round(img.height*scale);canvas.getContext("2d").drawImage(img,0,0,canvas.width,canvas.height);setPhoto(canvas.toDataURL("image/jpeg",0.72));}catch{setPhotoError("Não foi possível carregar a foto. Tente novamente.")}}
 return <Modal title="Nova encomenda" onClose={onClose}><div className="form"><label>Morador<select value={f.residentId} onChange={e=>setF({...f,residentId:e.target.value})}>{data.residents.map(r=><option value={r.id} key={r.id}>{r.name} — {r.block}/{r.apt}</option>)}</select></label><label>Entregador / transportadora<input value={f.courier} onChange={e=>setF({...f,courier:e.target.value})} placeholder="Nome ou empresa"/></label><label>Código de barras / rastreio<div className="scan-field"><input value={f.tracking} onChange={e=>setF({...f,tracking:e.target.value})} placeholder="Use Ler para escanear ou digite"/><button type="button" onClick={()=>setReadBarcode(true)}><ScanLine/> Escanear</button></div><small className="hint">Ao tocar em Escanear, a câmera deve ler o código da etiqueta e preencher este campo automaticamente.</small></label><label>Descrição<input value={f.description} onChange={e=>setF({...f,description:e.target.value})} placeholder="Caixa, envelope, mercado..."/></label><label>Foto da encomenda<input type="file" accept="image/*" capture="environment" onChange={e=>handlePhoto(e.target.files?.[0])}/></label>{photo&&<div style={{margin:"8px 0"}}><img src={photo} alt="Prévia da encomenda" style={{width:"100%",maxHeight:240,objectFit:"contain",borderRadius:10}}/><button type="button" onClick={()=>{setPhoto("");setPhotoError("")}}>Remover foto</button></div>}{photoError&&<p className="hint">{photoError}</p>}<label>Observações<textarea value={f.observations} onChange={e=>setF({...f,observations:e.target.value})}/></label><label>Quando deseja avisar o morador?<select value={f.notificationChoice} onChange={e=>setF({...f,notificationChoice:e.target.value})}><option value="later">Enviar depois — guardar na Central de Notificações</option><option value="now">Enviar agora — abrir WhatsApp após salvar</option></select></label><p className="hint">O WhatsApp abrirá com a mensagem preenchida. Você precisará tocar em Enviar e depois confirmar no The Door.</p><button className="primary wide" onClick={()=>{if(!f.residentId){alert("Cadastre um morador antes de registrar a encomenda.");return}onSave({...f,photo,residentName:r?.name,address:`${r?.block} / ${r?.apt}`,notificationChoice:f.notificationChoice})}}>Registrar encomenda</button></div>{readBarcode&&<Scanner title="Ler etiqueta da transportadora" orders={[]} onClose={()=>setReadBarcode(false)} onRead={value=>{setF(prev=>({...prev,tracking:value}));setReadBarcode(false)}} receiveMode/>}</Modal>
}
function ResidentForm({resident,unit,onClose,onSave}){const [f,setF]=useState(()=>resident?{name:resident.name||"",phone:resident.phone||"",block:resident.block||"",street:resident.street||"",quadra:resident.quadra||"",apt:resident.apt||""}:{name:"",phone:"",block:unit?.block||"",street:unit?.street||"",quadra:unit?.quadra||"",apt:unit?.apt||""});return <Modal title={resident?"Editar morador":"Cadastrar morador na unidade"} onClose={onClose}><div className="form"><p className="hint">{resident?"Altere o nome ou telefone. Se necessário, também é possível corrigir os dados da unidade.":"Preencha os dados do novo morador. Para adicionar alguém a uma unidade existente, use o botão Adicionar na unidade desejada."}</p>{Object.keys(f).map(k=><label key={k}>{({name:"Nome do morador",phone:"Telefone / WhatsApp",block:"Bloco",street:"Rua",quadra:"Quadra",apt:"Apartamento"})[k]}<input value={f[k]} onChange={e=>setF({...f,[k]:e.target.value})} required={k==="name"} placeholder={({name:"Nome completo",phone:"DDD + telefone",block:"Ex.: B",street:"Ex.: Rua 02",quadra:"Ex.: Q1",apt:"Ex.: 204"})[k]}/></label>)}<button className="primary wide" onClick={()=>{if(!f.name.trim()){alert("Informe o nome do morador.");return}onSave({...f,name:f.name.trim(),phone:f.phone.trim()})}}>{resident?"Salvar alterações":"Cadastrar morador"}</button></div></Modal>}
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
function QrModal({order,resident,onClose}){
 const [src,setSrc]=useState("");const [error,setError]=useState("");
 useEffect(()=>{let alive=true;QRCode.toDataURL(order.code,{width:320,margin:2,errorCorrectionLevel:"M"}).then(url=>{if(alive)setSrc(url)}).catch(()=>setError("Não foi possível gerar o QR Code."));return()=>{alive=false}},[order.code]);
 return <Modal title="QR Code da encomenda" onClose={onClose}><div className="qr-card">{src?<img src={src} alt={`QR Code ${order.code}`}/>:<p>{error||"Gerando QR Code..."}</p>}<strong>{order.code}</strong><p>{resident?.name||order.residentName||"Morador"}</p><p>{resident?`${resident.block} • Apto ${resident.apt}`:order.address}</p>{order.tracking&&<small>Rastreio: {order.tracking}</small>}<button className="primary wide" onClick={async()=>{if(!src)return;try{const blob=await (await fetch(src)).blob();const file=new File([blob],`The-Door-${order.code}.png`,{type:"image/png"});if(navigator.share&&navigator.canShare&&navigator.canShare({files:[file]})){await navigator.share({files:[file],title:`QR Code ${order.code}`,text:`QR Code da encomenda ${order.code}`});return}}catch(e){}const w=window.open("","_blank");if(w){w.document.write(`<title>QR ${order.code}</title><div style="font-family:Arial;text-align:center;padding:24px"><h2>The Door - ${order.code}</h2><img src="${src}" style="width:280px;height:280px"/><p>${resident?.name||order.residentName||"Morador"}</p><p>${resident?`${resident.block} • Apto ${resident.apt}`:order.address||""}</p></div>`);w.document.close();w.focus();setTimeout(()=>w.print(),300)}}}>Imprimir QR Code</button><button type="button" className="wide" onClick={async()=>{if(!src)return;const msg=`Olá, ${resident?.name||order.residentName||"morador"}! Segue o QR Code da sua encomenda ${order.code}. Apresente este código na portaria para retirada.`;try{const blob=await (await fetch(src)).blob();const file=new File([blob],`The-Door-${order.code}.png`,{type:"image/png"});if(navigator.share&&navigator.canShare&&navigator.canShare({files:[file]})){await navigator.share({files:[file],title:`QR Code ${order.code}`,text:msg});return}}catch(e){}const a=document.createElement("a");a.href=src;a.download=`The-Door-${order.code}.png`;a.click();const url=whatsappUrl(resident?.phone,msg);if(url)window.open(url,"_blank");else window.open("https://wa.me/?text="+encodeURIComponent(msg),"_blank")}}><Send/> Compartilhar QR Code</button><button type="button" className="wide" onClick={()=>{const msg=`Olá, ${resident?.name||order.residentName||"morador"}! Sua encomenda ${order.code} está disponível para retirada na portaria. Apresente o QR Code da encomenda no atendimento.`;const url=whatsappUrl(resident?.phone,msg);if(url){if(!openWhatsAppChat(resident?.phone,msg))window.open(url,"_blank")}else window.open("https://wa.me/?text="+encodeURIComponent(msg),"_blank")}}><Send/> Enviar aviso pelo WhatsApp</button></div></Modal>
}
function App(){
 const [user,setUser]=useState(null); const [checking,setChecking]=useState(true);
 useEffect(()=>onAuthStateChanged(auth,u=>{setUser(u);setChecking(false)}),[]);
 if(checking) return <div className="auth-screen"><div className="auth-card"><img src="./the-door-icon.png" alt="The Door"/><h1>The Door</h1><p>Verificando sua sessão...</p></div></div>;
 if(!user) return <LoginScreen/>;
 return <AppContent user={user} onLogout={()=>signOut(auth)}/>;
}
function LoginScreen(){
 const [mode,setMode]=useState("login"); const [email,setEmail]=useState(""); const [password,setPassword]=useState(""); const [busy,setBusy]=useState(false); const [error,setError]=useState("");
 async function run(action){setBusy(true);setError("");try{await action()}catch(e){const map={"auth/invalid-credential":"E-mail ou senha incorretos.","auth/user-not-found":"Conta não encontrada.","auth/wrong-password":"E-mail ou senha incorretos.","auth/email-already-in-use":"Este e-mail já possui cadastro.","auth/weak-password":"A senha deve ter pelo menos 6 caracteres.","auth/popup-closed-by-user":"A janela de login foi fechada.","auth/unauthorized-domain":"Este domínio não está autorizado no Firebase.","auth/operation-not-allowed":"Ative este método de login no Firebase Authentication."};setError(map[e.code]||`Não foi possível entrar. (${e.code||"erro"})`)}finally{setBusy(false)}}
 return <div className="auth-screen"><div className="auth-card"><img src="./the-door-icon.png" alt="Logo The Door"/><div className="auth-eyebrow">LOGÍSTICA DE ENCOMENDAS</div><h1>Bem-vindo ao The Door</h1><p className="auth-subtitle">Entre para acessar a gestão de encomendas do seu condomínio.</p><button className="google-button" disabled={busy} onClick={()=>run(()=>signInWithPopup(auth,new GoogleAuthProvider()))}><span className="google-g">G</span> Continuar com Google</button><div className="auth-separator"><span>ou use seu e-mail</span></div><form className="auth-form" onSubmit={e=>{e.preventDefault();run(()=>mode==="register"?createUserWithEmailAndPassword(auth,email,password):signInWithEmailAndPassword(auth,email,password))}}><label>E-mail<input type="email" autoComplete="email" value={email} onChange={e=>setEmail(e.target.value)} required placeholder="voce@exemplo.com"/></label><label>Senha<input type="password" autoComplete={mode==="register"?"new-password":"current-password"} value={password} onChange={e=>setPassword(e.target.value)} required minLength={6} placeholder="Mínimo de 6 caracteres"/></label>{error&&<p className="auth-error" role="alert">{error}</p>}<button className="primary wide" disabled={busy}>{busy?"Aguarde...":mode==="register"?"Criar conta":"Entrar"}</button></form><button className="auth-switch" onClick={()=>{setMode(mode==="register"?"login":"register");setError("")}}>{mode==="register"?"Já tem uma conta? Entrar":"Primeiro acesso? Criar conta com e-mail"}</button><p className="auth-footnote">Os dados desta versão ficam salvos neste navegador e perfil de usuário. A sincronização online entre funcionários e o controle de planos serão etapas posteriores.</p></div></div>
}
createRoot(document.getElementById("root")).render(<App/>);
