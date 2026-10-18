import React,{useEffect,useMemo,useRef,useState} from "react";
import {createRoot} from "react-dom/client";
import { onAuthStateChanged, signInWithPopup, GoogleAuthProvider, signInWithEmailAndPassword, createUserWithEmailAndPassword, signOut } from "firebase/auth";
import { auth } from "./firebase.js";
import QRCode from "qrcode";
import {Html5Qrcode,Html5QrcodeSupportedFormats} from "html5-qrcode";
import {PackagePlus,ScanLine,Users,History,Truck,MapPin,Trash2,Send,Search,Home,LogOut,Plus,CheckCircle2,Clock,ChevronRight,Pencil,UserPlus} from "lucide-react";
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
function AppContent({user,onLogout}){
 const [data,setData]=useState(()=>load(user.uid)); const [tab,setTab]=useState("home"); const [query,setQuery]=useState("");
 const [showAdd,setShowAdd]=useState(false); const [showResident,setShowResident]=useState(false); const [residentEdit,setResidentEdit]=useState(null); const [residentUnit,setResidentUnit]=useState(null); const [showCourier,setShowCourier]=useState(false); const [scan,setScan]=useState(false); const [qrOrder,setQrOrder]=useState(null);
 const [notice,setNotice]=useState("");
 useEffect(()=>localStorage.setItem(KEY_PREFIX+user.uid,JSON.stringify(data)),[data,user.uid]);
 const orders=data.orders;
 const pending=orders.filter(o=>o.status==="Pendente");
 const filtered=useMemo(()=>orders.filter(o=>JSON.stringify(o).toLowerCase().includes(query.toLowerCase())),[orders,query]);
 function notify(x){setNotice(x);setTimeout(()=>setNotice(""),2500)}
 function addOrder(o){setData(d=>({...d,orders:[{...o,id:uid("enc"),code:"TD-"+Math.random().toString(36).slice(2,8).toUpperCase(),status:"Pendente",receivedAt:new Date().toISOString()},...d.orders]}));setShowAdd(false);notify("Encomenda registrada.")}
 function removeOrder(id){if(confirm("Excluir esta encomenda?"))setData(d=>({...d,orders:d.orders.filter(o=>o.id!==id)}))}
 function deliver(id){setData(d=>({...d,orders:d.orders.map(o=>o.id===id?{...o,status:"Retirada",pickedAt:new Date().toISOString()}:o)}));notify("Encomenda baixada com sucesso.")}
 function scannedCheckout(value){const clean=value.trim();const o=orders.find(x=>x.status==="Pendente"&&(String(x.code).toLowerCase()===clean.toLowerCase()||String(x.tracking||"").toLowerCase()===clean.toLowerCase()));if(o){deliver(o.id);setScan(false)}else notify("Código não encontrado entre as encomendas pendentes.")}
 function sendWhatsApp(o){const r=data.residents.find(x=>x.id===o.residentId); if(!r)return; const msg=`Olá, ${r.name}! Sua encomenda ${o.code} foi recebida na portaria do condomínio. Apresente este código para retirada: ${o.code}`; window.open("https://wa.me/"+r.phone+"?text="+encodeURIComponent(msg),"_blank")}
 return <div className="app">
  <header><div className="brand"><img className="brand-logo" src={brandIcon} alt="Logo The Door"/><div><b>THE DOOR</b><small>Logística de encomendas para condomínios</small></div></div><div className="header-actions"><span className="user-email">{user.email||user.displayName||"Usuário"}</span><button onClick={()=>setScan(true)}><ScanLine/> Ler código</button><button onClick={onLogout}><LogOut/> Sair</button></div></header>
  <main>
   {tab==="home"&&<Dashboard pending={pending} orders={orders} onAdd={()=>setShowAdd(true)} onScan={()=>setScan(true)} onWhats={sendWhatsApp} onDeliver={deliver} onDelete={removeOrder}/>}
   {tab==="orders"&&<><SectionTitle icon={<History/>} title="Encomendas"/><div className="toolbar"><div className="search"><Search/><input value={query} onChange={e=>setQuery(e.target.value)} placeholder="Buscar código, morador, apartamento..."/></div><button className="primary" onClick={()=>setShowAdd(true)}><Plus/> Nova encomenda</button></div><OrderList orders={filtered} data={data} onWhats={sendWhatsApp} onDeliver={deliver} onDelete={removeOrder} onShowQr={setQrOrder}/></>}
   {tab==="residents"&&<><SectionTitle icon={<Users/>} title="Moradores por unidade"/><div className="toolbar"><div className="search"><Search/><input value={query} onChange={e=>setQuery(e.target.value)} placeholder="Buscar nome, telefone, bloco ou apartamento..."/></div><button className="primary" onClick={()=>{setResidentEdit(null);setResidentUnit(null);setShowResident(true)}}><Plus/> Cadastrar morador</button></div><div className="unit-list">{Object.entries(data.residents.filter(r=>JSON.stringify(r).toLowerCase().includes(query.toLowerCase())).reduce((groups,r)=>{const key=[r.block,r.street,r.quadra,r.apt].map(v=>(v||"").trim().toLowerCase()).join("|");if(!groups[key])groups[key]={key,block:r.block,street:r.street,quadra:r.quadra,apt:r.apt,residents:[]};groups[key].residents.push(r);return groups;},{})).sort((a,b)=>`${a[1].street} ${a[1].quadra} ${a[1].block} ${a[1].apt}`.localeCompare(`${b[1].street} ${b[1].quadra} ${b[1].block} ${b[1].apt}`,"pt-BR")).map(([key,u])=><div className="card unit-card" key={key}><div className="unit-heading"><div className="unit-icon"><MapPin/></div><div className="unit-title"><b>Unidade {u.apt||"não informada"}</b><small>{[u.block&&`Bloco ${u.block}`,u.street,u.quadra&&`Quadra ${u.quadra}`].filter(Boolean).join(" • ")||"Endereço não informado"}</small><small>{u.residents.length} morador(es) cadastrado(s)</small></div><button className="unit-add" onClick={()=>{setResidentEdit(null);setResidentUnit(u);setShowResident(true)}}><UserPlus/> Adicionar</button></div><div className="unit-residents">{u.residents.map(r=><div className="resident-row" key={r.id}><div className="resident-info"><b>{r.name}</b><small>WhatsApp: {r.phone||"Não informado"}</small></div><button className="edit-resident" title="Editar morador" onClick={()=>{setResidentEdit(r);setResidentUnit(null);setShowResident(true)}}><Pencil/> Editar</button></div>)}</div></div>)}</div>{data.residents.length===0&&<div className="empty">Nenhum morador cadastrado. Use “Cadastrar morador” para começar.</div>}</>}
   {tab==="couriers"&&<><SectionTitle icon={<Truck/>} title="Entregadores"/><div className="toolbar"><button className="primary" onClick={()=>setShowCourier(true)}><Plus/> Cadastrar entregador</button></div><div className="cards">{data.couriers.map(c=><div className="card" key={c.id}><b>{c.name}</b><small>{c.company||"Sem empresa"} • {c.phone||"Sem telefone"}</small><small>Documento: {c.doc||"—"} • Placa: {c.plate||"—"}</small></div>)}</div></>}
   {tab==="history"&&<><SectionTitle icon={<History/>} title="Histórico de retiradas"/><OrderList orders={orders.filter(o=>o.status==="Retirada")} data={data} onWhats={sendWhatsApp} onDeliver={deliver} onDelete={removeOrder} onShowQr={setQrOrder}/></>}
  </main>
  <nav>{[["home","Início",Home],["orders","Encomendas",History],["residents","Moradores",Users],["couriers","Entregadores",Truck],["history","Histórico",Clock]].map(([k,l,I])=><button className={tab===k?"active":""} onClick={()=>setTab(k)} key={k}><I/><span>{l}</span></button>)}</nav>
  {showAdd&&<AddOrder data={data} onClose={()=>setShowAdd(false)} onSave={addOrder}/>}
  {showResident&&<ResidentForm resident={residentEdit} unit={residentUnit} onClose={()=>{setShowResident(false);setResidentEdit(null);setResidentUnit(null)}} onSave={r=>{setData(d=>({...d,residents:residentEdit?d.residents.map(old=>old.id===residentEdit.id?{...old,...r,id:old.id}:old):[...d.residents,{...r,id:uid("mor")}] }));setShowResident(false);setResidentEdit(null);setResidentUnit(null);notify(residentEdit?"Morador atualizado com sucesso.":"Morador cadastrado na unidade.")}}/>}
  {showCourier&&<CourierForm onClose={()=>setShowCourier(false)} onSave={c=>{setData(d=>({...d,couriers:[...d.couriers,{...c,id:uid("ent")}] }));setShowCourier(false)}}/>}
  {scan&&<Scanner orders={orders} onClose={()=>setScan(false)} onRead={scannedCheckout}/>}
  {qrOrder&&<QrModal order={qrOrder} resident={data.residents.find(r=>r.id===qrOrder.residentId)} onClose={()=>setQrOrder(null)}/> }
  {notice&&<div className="toast">{notice}</div>}
 </div>
}
function SectionTitle({icon,title}){return <div className="section-title">{icon}<h2>{title}</h2></div>}
function Dashboard({pending,orders,onAdd,onScan,onWhats,onDeliver,onDelete}){
 return <><div className="hero"><div><span className="eyebrow">PORTARIA</span><h1>Controle de encomendas</h1><p>Receba, notifique e dê baixa com QR Code.</p></div><div className="hero-buttons"><button className="primary" onClick={onAdd}><PackagePlus/> Nova encomenda</button><button onClick={onScan}><ScanLine/> Ler QR</button></div></div>
 <div className="stats"><Stat icon={<Clock/>} label="Aguardando" value={pending.length}/><Stat icon={<PackagePlus/>} label="Recebidas" value={orders.length}/><Stat icon={<CheckCircle2/>} label="Retiradas" value={orders.filter(o=>o.status==="Retirada").length}/></div>
 <SectionTitle icon={<Clock/>} title="Aguardando retirada"/><OrderList orders={pending.slice(0,6)} data={null} onWhats={onWhats} onDeliver={onDeliver} onDelete={onDelete}/>
 </>}
function Stat({icon,label,value}){return <div className="stat">{icon}<div><small>{label}</small><strong>{value}</strong></div></div>}
function OrderList({orders,data,onWhats,onDeliver,onDelete,onShowQr}){
 if(!orders.length)return <div className="empty">Nenhuma encomenda encontrada.</div>;
 return <div className="cards">{orders.map(o=><OrderCard key={o.id} o={o} data={data} onWhats={onWhats} onDeliver={onDeliver} onDelete={onDelete} onShowQr={onShowQr}/>)}</div>
}
function OrderCard({o,data,onWhats,onDeliver,onDelete,onShowQr}){
 const resident=data?.residents?.find(r=>r.id===o.residentId); return <div className="card order"><div className="order-main"><div className="code">Código The Door: {o.code}</div>{o.tracking&&<small>Código de barras/rastreio: {o.tracking}</small>}<b>{resident?.name||o.residentName||"Morador"}</b><small>{resident?`${resident.block} • Apto ${resident.apt} • ${resident.street} • ${resident.quadra}`:o.address}</small><small>Recebida: {new Date(o.receivedAt).toLocaleString("pt-BR")}</small><span className={o.status==="Retirada"?"badge done":"badge"}>{o.status}</span></div><div className="order-actions">{onShowQr&&<button title="Ver QR Code próprio" onClick={()=>onShowQr(o)}><ScanLine/></button>}{o.status==="Pendente"&&<button title="WhatsApp" onClick={()=>onWhats(o)}><Send/></button>}{o.status==="Pendente"&&<button className="ok" title="Dar baixa manual" onClick={()=>onDeliver(o.id)}><CheckCircle2/></button>}<button className="danger" title="Excluir" onClick={()=>onDelete(o.id)}><Trash2/></button></div></div>
}
function Modal({title,children,onClose}){return <div className="overlay"><div className="modal"><div className="modalhead"><h3>{title}</h3><button onClick={onClose}>×</button></div>{children}</div></div>}
function AddOrder({data,onClose,onSave}){
 const [f,setF]=useState({residentId:data.residents[0]?.id||"",courier:"",tracking:"",description:"",observations:""}); const [readBarcode,setReadBarcode]=useState(false); const r=data.residents.find(x=>x.id===f.residentId);
 return <Modal title="Nova encomenda" onClose={onClose}><div className="form"><label>Morador<select value={f.residentId} onChange={e=>setF({...f,residentId:e.target.value})}>{data.residents.map(r=><option value={r.id} key={r.id}>{r.name} — {r.block}/{r.apt}</option>)}</select></label><label>Entregador / transportadora<input value={f.courier} onChange={e=>setF({...f,courier:e.target.value})} placeholder="Nome ou empresa"/></label><label>Código de barras / rastreio<div className="scan-field"><input value={f.tracking} onChange={e=>setF({...f,tracking:e.target.value})} placeholder="Escaneie ou digite o código"/><button type="button" onClick={()=>setReadBarcode(true)}><ScanLine/> Ler</button></div></label><label>Descrição<input value={f.description} onChange={e=>setF({...f,description:e.target.value})} placeholder="Caixa, envelope, mercado..."/></label><label>Observações<textarea value={f.observations} onChange={e=>setF({...f,observations:e.target.value})}/></label><p className="hint">Ao salvar, o sistema gera um código próprio The Door e um QR Code exclusivo para esta encomenda.</p><button className="primary wide" onClick={()=>{if(!f.residentId){alert("Cadastre um morador antes de registrar a encomenda.");return}onSave({...f,residentName:r?.name,address:`${r?.block} / ${r?.apt}`})}}>Registrar encomenda</button></div>{readBarcode&&<Scanner title="Ler etiqueta da transportadora" orders={[]} onClose={()=>setReadBarcode(false)} onRead={value=>{setF(prev=>({...prev,tracking:value}));setReadBarcode(false)}} receiveMode/>}</Modal>
}
function ResidentForm({resident,unit,onClose,onSave}){const [f,setF]=useState(()=>resident?{name:resident.name||"",phone:resident.phone||"",block:resident.block||"",street:resident.street||"",quadra:resident.quadra||"",apt:resident.apt||""}:{name:"",phone:"",block:unit?.block||"",street:unit?.street||"",quadra:unit?.quadra||"",apt:unit?.apt||""});return <Modal title={resident?"Editar morador":"Cadastrar morador na unidade"} onClose={onClose}><div className="form"><p className="hint">{resident?"Altere o nome ou telefone. Se necessário, também é possível corrigir os dados da unidade.":"Preencha os dados do novo morador. Para adicionar alguém a uma unidade existente, use o botão Adicionar na unidade desejada."}</p>{Object.keys(f).map(k=><label key={k}>{({name:"Nome do morador",phone:"Telefone / WhatsApp",block:"Bloco",street:"Rua",quadra:"Quadra",apt:"Apartamento"})[k]}<input value={f[k]} onChange={e=>setF({...f,[k]:e.target.value})} required={k==="name"} placeholder={({name:"Nome completo",phone:"DDD + telefone",block:"Ex.: B",street:"Ex.: Rua 02",quadra:"Ex.: Q1",apt:"Ex.: 204"})[k]}/></label>)}<button className="primary wide" onClick={()=>{if(!f.name.trim()){alert("Informe o nome do morador.");return}onSave({...f,name:f.name.trim(),phone:f.phone.trim()})}}>{resident?"Salvar alterações":"Cadastrar morador"}</button></div></Modal>}
function CourierForm({onClose,onSave}){const [f,setF]=useState({name:"",company:"",phone:"",doc:"",plate:""});return <Modal title="Cadastrar entregador" onClose={onClose}><div className="form">{Object.keys(f).map(k=><label key={k}>{({name:"Nome",company:"Empresa",phone:"Telefone",doc:"Documento",plate:"Placa"})[k]}<input value={f[k]} onChange={e=>setF({...f,[k]:e.target.value})}/></label>)}<button className="primary wide" onClick={()=>onSave(f)}>Salvar entregador</button></div></Modal>}
function Scanner({orders,onClose,onRead,title="Ler código de barras ou QR Code",receiveMode=false}){
 const [msg,setMsg]=useState(receiveMode?"Aponte a câmera para o código de barras da etiqueta.":"Escaneie o código The Door ou o rastreio da etiqueta."); const finished=useRef(false);
 useEffect(()=>{let qr;let active=true;const formats=[Html5QrcodeSupportedFormats.QR_CODE,Html5QrcodeSupportedFormats.CODE_128,Html5QrcodeSupportedFormats.CODE_39,Html5QrcodeSupportedFormats.CODE_93,Html5QrcodeSupportedFormats.EAN_13,Html5QrcodeSupportedFormats.EAN_8,Html5QrcodeSupportedFormats.UPC_A,Html5QrcodeSupportedFormats.UPC_E,Html5QrcodeSupportedFormats.ITF,Html5QrcodeSupportedFormats.CODABAR];
  qr=new Html5Qrcode("qr-reader",{formatsToSupport:formats,verbose:false});
  qr.start({facingMode:"environment"},{fps:10,qrbox:{width:280,height:160}},text=>{if(!active||finished.current)return;finished.current=true;setMsg("Código lido: "+text);try{onRead(text)}catch{};qr.stop().catch(()=>{})}).catch(()=>setMsg("Não foi possível abrir a câmera. Permita o acesso e use HTTPS ou um leitor USB/Bluetooth no computador."));
  return()=>{active=false;if(qr)qr.stop().catch(()=>{})};
 },[]);
 return <Modal title={title} onClose={onClose}><div id="qr-reader"></div><p className="scanmsg">{msg}</p><p className="hint">Compatível com QR Code e formatos comuns de barras. Alguns códigos logísticos podem exigir um leitor físico compatível.</p></Modal>
}
function QrModal({order,resident,onClose}){
 const [src,setSrc]=useState("");const [error,setError]=useState("");
 useEffect(()=>{let alive=true;QRCode.toDataURL(order.code,{width:320,margin:2,errorCorrectionLevel:"M"}).then(url=>{if(alive)setSrc(url)}).catch(()=>setError("Não foi possível gerar o QR Code."));return()=>{alive=false}},[order.code]);
 return <Modal title="QR Code da encomenda" onClose={onClose}><div className="qr-card">{src?<img src={src} alt={`QR Code ${order.code}`}/>:<p>{error||"Gerando QR Code..."}</p>}<strong>{order.code}</strong><p>{resident?.name||order.residentName||"Morador"}</p><p>{resident?`${resident.block} • Apto ${resident.apt}`:order.address}</p>{order.tracking&&<small>Rastreio: {order.tracking}</small>}<button className="primary wide" onClick={()=>{if(!src)return;const w=window.open("","_blank");if(w){w.document.write(`<title>QR ${order.code}</title><div style="font-family:Arial;text-align:center;padding:24px"><h2>The Door - ${order.code}</h2><img src="${src}" style="width:280px;height:280px"/><p>${resident?.name||order.residentName||"Morador"}</p><p>${resident?`${resident.block} • Apto ${resident.apt}`:order.address||""}</p></div>`);w.document.close();w.focus();setTimeout(()=>w.print(),300)}}}>Imprimir QR Code</button></div></Modal>
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
