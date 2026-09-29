    (() => {
      'use strict';
      const loginCard = document.querySelector('#login-card');
      const loginForm = document.querySelector('#login-form');
      const loginButton = document.querySelector('#login-button');
      const loginStatus = document.querySelector('#login-status');
      const reportApp = document.querySelector('#report-app');
      const fromInput = document.querySelector('#date-from');
      const toInput = document.querySelector('#date-to');
      const loadButton = document.querySelector('#load');
      const status = document.querySelector('#status');
      const totalOutput = document.querySelector('#total');
      const plot = document.querySelector('#plot-area');
      const yAxis = document.querySelector('#y-axis');
      const pad = value => String(value).padStart(2, '0');
      const toDateInput = date => `${date.getFullYear()}-${pad(date.getMonth()+1)}-${pad(date.getDate())}`;
      const parseDate = value => { const [year,month,day]=value.split('-').map(Number); return new Date(year,month-1,day); };
      const nextDay = date => new Date(date.getFullYear(),date.getMonth(),date.getDate()+1);
      const dayKey = date => toDateInput(date);

      function showReport(show) { reportApp.hidden = !show; loginCard.hidden = show; }
      function setStatus(message,error=false) { status.textContent=message; status.classList.toggle('error',error); }
      function setLoginStatus(message,error=false) { loginStatus.textContent=message; loginStatus.classList.toggle('error',error); }
      function localDefaults() { const today=new Date(); const start=new Date(today.getFullYear(),today.getMonth(),today.getDate()-6); fromInput.value=toDateInput(start); toInput.value=toDateInput(today); }

      async function api(path, options={}) {
        const response=await fetch(path,{...options,cache:'no-store',credentials:'same-origin',headers:{...(options.body?{'Content-Type':'application/json'}:{}),...(options.headers||{})}});
        if(response.status===401) { showReport(false); throw new Error('Сессия завершилась. Войдите снова.'); }
        if(response.status===404) throw new Error('Сервер отчёта ещё не подключён.');
        const body=await response.json().catch(()=>({}));
        if(!response.ok) throw new Error(body.message || 'Не удалось выполнить запрос.');
        return body;
      }

      function renderChart(days) {
        const max=Math.max(0,...days.map(day=>day.count));
        const top=max===0?1:max;
        yAxis.replaceChildren(...[top,Math.ceil(top*.75),Math.ceil(top*.5),Math.ceil(top*.25),0].map(value=>{const tick=document.createElement('span');tick.textContent=String(value);return tick;}));
        plot.replaceChildren();
        if(days.every(day=>day.count===0)) { const empty=document.createElement('div'); empty.className='empty-state'; empty.textContent='За выбранный период сделок не найдено'; plot.append(empty); }
        const plotWidth=Math.max(620,days.length*46);
        plot.style.width=`${plotWidth}px`;
        for(const day of days) {
          const column=document.createElement('div'); column.className='bar-column';
          const wrap=document.createElement('div'); wrap.className='bar-wrap';
          const bar=document.createElement('div'); bar.className='bar'; bar.style.height=day.count?`${Math.max(1,day.count/top*100)}%`:'0';
          bar.setAttribute('role','img'); bar.setAttribute('aria-label',`${day.label}: ${day.count} сделок`);
          const value=document.createElement('span'); value.className='bar-value'; value.textContent=String(day.count); bar.append(value); wrap.append(bar);
          const label=document.createElement('span'); label.className='day-label'; label.setAttribute('aria-label',day.shortLabel); label.title=day.shortLabel;
          const dateLabel=document.createElement('span'); dateLabel.className='day-label-date'; dateLabel.textContent=day.axisLabel||day.shortLabel;
          const yearLabel=document.createElement('span'); yearLabel.className='day-label-year'; yearLabel.textContent=day.yearLabel||'';
          label.append(dateLabel,yearLabel); column.append(wrap,label); plot.append(column);
        }
        totalOutput.textContent=String(days.reduce((sum,day)=>sum+day.count,0));
      }

      async function loadReport() {
        const from=fromInput.value, to=toInput.value;
        if(!from || !to || from>to) { setStatus('Укажите корректный период: дата начала должна быть не позже даты окончания.',true); return; }
        loadButton.disabled=true; fromInput.disabled=true; toInput.disabled=true;
        const counts=new Map();
        setStatus('Загружаю сделки из Bitrix24…');
        try {
          let cursor=0, total=null, loaded=0;
          while(true) {
            let page;
            for(let attempt=0;;attempt++) {
              try {
                const query=new URLSearchParams({from,to,timezoneOffset:String(new Date().getTimezoneOffset()),start:String(cursor)});
                page=await api(`/api/report?${query.toString()}`);
                break;
              } catch(error) {
                if(attempt>=3 || !/лимит|попробуйте позже/i.test(error.message)) throw error;
                await new Promise(resolve=>setTimeout(resolve,600*2**attempt));
              }
            }
            for(const [day,count] of Object.entries(page.counts||{})) counts.set(day,(counts.get(day)||0)+count);
            loaded+=page.pageCount||0; total=page.total;
            setStatus(total===null?'Загружаю сделки…':`Получено ${loaded.toLocaleString('ru-RU')} из ${total.toLocaleString('ru-RU')} сделок…`);
            if(page.next===null || page.next===undefined) break;
            cursor=page.next;
          }
          const days=[];
          for(let date=parseDate(from),end=parseDate(to);date<=end;date=nextDay(date)) {
            const key=dayKey(date); const label=new Intl.DateTimeFormat('ru-RU',{weekday:'short'}).format(date).replace('.','');
            days.push({key,count:counts.get(key)||0,label,axisLabel:`${pad(date.getDate())}.${pad(date.getMonth()+1)}`,yearLabel:days.length===0||(date.getMonth()===0&&date.getDate()===1)?String(date.getFullYear()):'',shortLabel:`${pad(date.getDate())}.${pad(date.getMonth()+1)}.${date.getFullYear()}`});
          }
          renderChart(days);
          setStatus(`Отчёт готов: ${days[0].shortLabel} — ${days[days.length-1].shortLabel}.`);
        } catch(error) { setStatus(error.message||'Ошибка загрузки отчёта.',true); }
        finally { loadButton.disabled=false; fromInput.disabled=false; toInput.disabled=false; }
      }

      loginForm.addEventListener('submit',async event=>{
        event.preventDefault(); loginButton.disabled=true; setLoginStatus('Проверяю доступ…');
        try { await api('/api/login',{method:'POST',body:JSON.stringify({password:document.querySelector('#password').value})}); document.querySelector('#password').value=''; showReport(true); setLoginStatus(''); await loadReport(); }
        catch(error) { setLoginStatus(error.message||'Не удалось войти.',true); }
        finally { loginButton.disabled=false; }
      });
      loadButton.addEventListener('click',loadReport);
      document.querySelector('#logout').addEventListener('click',async()=>{try{await api('/api/logout',{method:'POST',body:'{}'});}catch{}showReport(false);setLoginStatus('Вы вышли из отчёта.');});
      localDefaults();
      api('/api/session').then(()=>{showReport(true);}).catch(error=>{showReport(false);if(!/401|сессия/i.test(error.message))setLoginStatus('Сервер отчёта ещё не подключён.');});
    })();

