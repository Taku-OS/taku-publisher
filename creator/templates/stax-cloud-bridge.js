(function(){
  const MESSAGE_PREFIX='taku:stax-studio:';
  const PARENT_ORIGIN=window.location.origin;
  let initialized=false;
  let publishing=false;
  function currentLayout(){
    return {
      schemaVersion:'taku.stax.studio-layout.v1',
      blocks:Array.isArray(placedP)?placedP.map((item)=>({key:item.key,cx:item.cx,cy:item.cy,cw:item.cw,ch:item.ch})):[],
    };
  }
  function post(type,payload){
    if(window.parent===window)return;
    window.parent.postMessage({type:MESSAGE_PREFIX+type,...(payload||{})},PARENT_ORIGIN);
  }
  window.__TAKU_STAX_POST__=post;
  function clearBoard(){
    cancelGrow();
    finishCountUps();
    window.__TAKU_STAX_LAYOUT_BUILDING__=false;
    if(!Array.isArray(placedP))return;
    placedP.splice(0).forEach((item)=>item.el&&item.el.remove());
    if(typeof chipRefs==='object'&&chipRefs){Object.values(chipRefs).forEach((chip)=>chip&&chip.classList&&chip.classList.remove('on'));}
    if(typeof counts==='function')counts();
  }
  function applyLayout(layout){
    if(!layout||!Array.isArray(layout.blocks))return;
    const blocks=layout.blocks;
    clearBoard();
    blocks.filter((item)=>item&&item.key!=='bracket'&&item.key!=='knock').forEach((item)=>{
      if(!item||typeof item.key!=='string'||typeof place!=='function'||!blockSize(item.key))return;
      const placed=place(item.key,Number(item.cx)||0,Number(item.cy)||0);
      if(placed&&typeof chipRefs==='object'&&chipRefs[placed.key])chipRefs[placed.key].classList.add('on');
    });
    // Intro completion must preserve the restored draft, including an empty
    // board or blocks added after the initial selectedKeys were generated.
    const persona=PERSONAS[CURP];
    if(persona){
      persona.fullset=placedP.map(item=>item.key);
      persona.layout=Object.fromEntries(placedP.map(item=>[item.key,[item.cx,item.cy]]));
    }
  }
  function initialize(message){
    const model=message&&message.model&&typeof message.model==='object'?message.model:null;
    if(!model||typeof window.__TAKU_STAX_BOOTSTRAP__!=='function')return;
    window.__TAKU_STAX_DATA__={...model,readonly:false,publishedStax:{...(model.publishedStax||{})}};
    window.__TAKU_STAX_BOOTSTRAP__();
    setStaxPublication(window.__TAKU_STAX_DATA__.publishedStax);
    applyLayout(message.layout||model.studioLayout);
    if(message.mode==='campaign-review'){
      document.body.classList.add('taku-campaign-review');
      document.getElementById('scanov')?.classList.add('off');
      document.getElementById('revealov')?.classList.remove('on');
      document.getElementById('shareov')?.classList.remove('on');
    }else{
      document.body.classList.remove('taku-campaign-review');
    }
    document.body.classList.add('taku-cloud-ready');
    initialized=true;
    post('ready',{layout:currentLayout()});
  }
  function finishPublish(message){
    const publication=message&&message.publication&&typeof message.publication==='object'?message.publication:null;
    if(!publication||typeof setStaxPublication!=='function')return;
    setStaxPublication(publication);
    publishing=false;
    const button=document.getElementById('mpost');
    if(button){button.disabled=false;button.textContent='Posted ✓';}
    document.getElementById('modal')?.classList.remove('on');
    if(typeof confetti==='function')confetti();
    if(message.message&&typeof toast==='function')toast(String(message.message));
  }
  function failPublish(message){
    publishing=false;
    const button=document.getElementById('mpost');
    if(button){button.disabled=false;button.textContent='Try again';}
    if(message&&message.message&&typeof toast==='function')toast(String(message.message));
  }
  window.addEventListener('message',(event)=>{
    if(event.source!==window.parent||event.origin!==PARENT_ORIGIN)return;
    const message=event.data;
    if(!message||typeof message.type!=='string'||!message.type.startsWith(MESSAGE_PREFIX))return;
    if(message.type===MESSAGE_PREFIX+'init')initialize(message);
    if(message.type===MESSAGE_PREFIX+'advance-intro'&&initialized){
      if(document.getElementById('revealov')?.classList.contains('on'))document.getElementById('cslide')?.click();
      else if(!document.getElementById('scanov')?.classList.contains('off')&&!document.getElementById('scanov')?.classList.contains('authmode'))window.__TAKU_STAX_JUMP_INTRO__?.();
    }
    if(message.type===MESSAGE_PREFIX+'published')finishPublish(message);
    if(message.type===MESSAGE_PREFIX+'publish-error')failPublish(message);
    if(message.type===MESSAGE_PREFIX+'settings-saved'){
      if(typeof window.__TAKU_GITHUB_SAVE_SUCCESS__==='function')window.__TAKU_GITHUB_SAVE_SUCCESS__(message);
      setTimeout(()=>post('layout-change',{layout:currentLayout()}),0);
    }
    if(message.type===MESSAGE_PREFIX+'settings-error'){
      if(String(message.requestId||'').startsWith('github-')&&typeof window.__TAKU_GITHUB_SAVE_ERROR__==='function')window.__TAKU_GITHUB_SAVE_ERROR__(message);
      else if(message.message&&typeof toast==='function')toast(String(message.message));
    }
    if(message.type===MESSAGE_PREFIX+'status'&&message.message&&typeof toast==='function')toast(String(message.message));
  });
  document.addEventListener('click',async(event)=>{
    const target=event.target instanceof Element?event.target.closest('#mpost'):null;
    if(!target||!initialized)return;
    event.preventDefault();
    event.stopImmediatePropagation();
    if(publishing)return;
    publishing=true;
    target.disabled=true;
    target.textContent='Capturing…';
    try{
      const staxCardSnapshot=await currentStaxCardSnapshot();
      target.textContent='Publishing…';
      post('publish',{layout:currentLayout(),staxCardSnapshot});
    }catch(error){
      failPublish({message:error&&error.message?error.message:'Could not capture the Stax Card image.'});
    }
  },true);
  const reportLayout=()=>{if(initialized&&!window.__TAKU_STAX_LAYOUT_BUILDING__)post('layout-change',{layout:currentLayout()});};
  window.__TAKU_STAX_REPORT_LAYOUT__=reportLayout;
  document.addEventListener('pointerup',(event)=>{
    if(event.target instanceof Element&&event.target.closest('#mpost'))return;
    setTimeout(reportLayout,0);
  },true);
  document.addEventListener('click',(event)=>{
    if(event.target instanceof Element&&event.target.closest('#ball,#bclear,.dock'))setTimeout(reportLayout,0);
  });
  post('booted');
})();
