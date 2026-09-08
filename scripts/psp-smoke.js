// Appended only to the --smoke guest. Hardware receives the production UI and
// provider with a deterministic controller driver; no device IO is added here.
(() => {
  const frame = globalThis.frame, s = globalThis.__map;
  let phase=0, age=0, total=0, marked="", ended=false;
  const QA="PSP USB regression";
  function mark(name){if(marked===name)return;const id=s.io.request("map.info",JSON.stringify({qa:name}),()=>{});if(id)marked=name;}
  function next(){phase++;age=0;}
  function ready(){return s.front()?.tiles.every(t=>s.frontView.state(t.input).status==="ready");}
  function require(value,label){if(!value){mark(`FAILED ${label}`);ended=true;}}
  globalThis.frame=(...args)=>{
    age++;total++;args[0]=0;args[1]=0x8080;
    if(!ended){
      if(total>9000){mark(`FAILED timeout phase ${phase}`);ended=true;}
      if(phase===0){if(s.info()&&ready()&&age>100){mark("map");next();}}
      else if(phase===1){
        if(age===30)args[0]=0x1000;
        if(age===60)mark("keyboard");
        if(age===80)args[0]=0x2000;
        if(age===90){require(s.query().length>0,"keyboard type");args[0]=0x8000;}
        if(age===100){require(s.query()==="","keyboard delete");s.setQuery("San Francisco");}
        if(age===120)args[0]=8;
        if(s.mode()==="results")next();
      }
      else if(phase===2){if(s.rows().length){mark("search");if(age>140){args[0]=0x2000;next();}}}
      else if(phase===3){if(age>120&&age<300)args[1]=0xff80;if(age===370)mark("pan");if(age>450){next();}}
      else if(phase===4){if(age===20)args[0]=0x200;if(age===21)args[0]=0x2200;if(age>100&&ready()){mark("zoom");next();}}
      else if(phase===5){if(age===80)args[0]=8;if(age===110){require(s.mode()==="name","save keyboard");s.saved.changeName(QA);mark("save");}if(age===140)args[0]=8;if(s.mode()==="saved")next();}
      else if(phase===6){if(s.saved.page()?.items.some(p=>p.name===QA)){mark("saved");if(age===120)args[0]=0x8000;if(age===160)args[0]=0x2000;}if(age>160&&!s.saved.busy()&&!s.saved.deleting()&&!s.saved.page()?.items.some(p=>p.name===QA)){mark("deleted");next();}}
      else if(phase===7){if(age===30)args[0]=0x4000;if(age>=60&&age<70)args[0]=0x200;if([62,64,66].includes(age))args[0]|=0x40;if(age===68)args[0]|=0x2000;if(age===90){require(s.mode()==="sources","source menu");s.setSelection(s.maps().findIndex(m=>m.kind==="hyrule"));}if(age===110)args[0]=0x2000;if(age>130&&s.info()?.kind==="hyrule"&&ready()){mark("hyrule");next();}}
      else if(phase===8){if(age===140){s.switchMap("osm");}if(age>160&&s.info()?.kind==="osm"&&ready()){mark("done");ended=true;}}
    }
    frame(...args);
  };
})();
