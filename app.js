/* CEF Christmas CPC Staff Portal - browser client.
   Critical financial operations are intentionally expected to be enforced by Supabase SQL/RLS,
   not trusted to this client. Configure the SQL migration before using real records. */
(() => {
  const $ = (s) => document.querySelector(s);
  const configKey = "cef_cpc_supabase_config";
  let supabase = null, currentUser = null, profile = null, activeView = "dashboard";
  let openedReport = null, openedExpenseId = null;
  const appState = { staff: [], seminars: [], clubs: [], outreach: [], funding: [], allocations: [], expenses: [], attachments: [] };
  let attachmentLoadError = "";
  const money = n => "PKR " + Number(n || 0).toLocaleString("en-PK", {maximumFractionDigits:2});
  const esc = s => String(s ?? "").replace(/[&<>"']/g, c => ({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));
  const titleCase = s => String(s||"").replaceAll("_"," ").replace(/-/g," ").replace(/\b\w/g,c=>c.toUpperCase());
  const setMessage = (el, msg, isError=true) => { el.textContent=msg; el.style.color=isError?"#9f2637":"#23653b"; };
  function toast(msg, error=false){const t=$("#toast");t.textContent=msg;t.classList.remove("hidden","error");if(error)t.classList.add("error");setTimeout(()=>t.classList.add("hidden"),4000);}
  function config(){try{return JSON.parse(localStorage.getItem(configKey)||"null")}catch{return null}}
  function clientFromConfig(){const c=config();if(!c||!window.supabase)return null;try{return window.supabase.createClient(c.url,c.key)}catch(e){console.error(e);return null}}
  function showScreen(id){["#setup-screen","#login-screen","#portal-screen"].forEach(s=>$(s).classList.toggle("hidden",s!==id))}
  function configure(){const c=config();$("#project-url").value=c?.url||"";$("#anon-key").value=c?.key||"";showScreen("#setup-screen")}
  function getName(){return profile?.full_name||profile?.name||currentUser?.email?.split("@")[0]||"CEF Staff"}
  function isAdmin(){return ["admin","program_leader","super_admin"].includes(String(profile?.role||"").toLowerCase())}
  function staffForReport(r){return appState.staff.find(x=>String(x.id)===String(r?.staff_id)||String(x.user_id)===String(r?.created_by))||null}
  function reportCode(kind,r,staff){
    const program=({seminars:"CPC Seminar",clubs:"CPC Club",outreach:"Teacher Outreach",funding:"Additional Funding"})[kind]||"Program";
    const code=staff?.staff_code||"STAFF";
    return `${program} - ${code}`;
  }
  function statusPill(status){let cl=String(status||"draft").toLowerCase().replaceAll(" ","-");return `<span class="status ${esc(cl)}">${esc(titleCase(status||"Draft"))}</span>`}
  async function connectAndBoot(){
    supabase=clientFromConfig();
    if(!supabase){showScreen("#login-screen");return}
    const {data:{session}}=await supabase.auth.getSession();
    if(session){currentUser=session.user;await enterPortal()}else showScreen("#login-screen");
    supabase.auth.onAuthStateChange(async (_event,session)=>{if(session){currentUser=session.user;await enterPortal()}else{currentUser=null;profile=null;showScreen("#login-screen")}});
  }
  async function signIn(e){e.preventDefault();const c=config();if(!c){configure();return}
    if(!supabase)supabase=clientFromConfig();const msg=$("#login-message");setMessage(msg,"Signing in…",false);
    const {error}=await supabase.auth.signInWithPassword({email:$("#login-email").value.trim(),password:$("#login-password").value});
    if(error)setMessage(msg,error.message);else setMessage(msg,"Signed in. Loading your workspace…",false);
  }
  async function signUp(e){
    e.preventDefault();if(!supabase)supabase=clientFromConfig();if(!supabase){configure();return}
    const msg=$("#login-message");setMessage(msg,"Creating your staff account…",false);
    const fullName=$("#signup-name").value.trim(),staffCode=$("#signup-code").value.trim(),city=$("#signup-city").value.trim(),region=$("#signup-region").value.trim(),state=$("#signup-state").value.trim(),email=$("#signup-email").value.trim(),password=$("#signup-password").value;
    try{
      const {data,error}=await supabase.auth.signUp({email,password,options:{data:{full_name:fullName,staff_code:staffCode,city,region,state}}});
      if(error)throw error;
      setMessage(msg,data.session?"Account created. Opening your workspace…":"Account created. Check your email to confirm the account, then sign in.",false);
      if(data.session){currentUser=data.user;await enterPortal()}
    }catch(err){setMessage(msg,err.message||"Sign up failed.")}
  }
  async function resetPassword(){if(!supabase)supabase=clientFromConfig();if(!supabase){configure();return}
    const email=$("#login-email").value.trim();if(!email){toast("Enter your email address first.",true);return}
    const {error}=await supabase.auth.resetPasswordForEmail(email,{redirectTo:location.href});
    toast(error?error.message:"If the account exists, a password reset email will be sent.",!!error);
  }
  async function enterPortal(){
    showScreen("#portal-screen");
    try{
      const {data,error}=await supabase.from("staff_profiles").select("*").eq("user_id",currentUser.id).maybeSingle();
      if(error)throw error;profile=data;
      if(!profile){$("#notice").classList.remove("hidden");$("#notice").textContent="Your login works, but your staff profile has not been linked yet. Ask the authorized CEF administrator to create/link your staff record in Supabase."; }
      else $("#notice").classList.add("hidden");
      $("#user-name").textContent=getName();$("#user-role").textContent=titleCase(profile?.role||"staff");$("#user-avatar").textContent=getName().trim().charAt(0).toUpperCase();
      $("#nav .admin-only").classList.toggle("hidden",!isAdmin());
      await loadData();renderView();
    }catch(e){console.error(e);$("#notice").classList.remove("hidden");$("#notice").textContent="Could not load staff profile/data. Check that the supplied SQL migration and Row Level Security policies have been applied. "+e.message;renderView()}
  }
  async function loadData(){
    const tables=[["staff","staff_profiles"],["seminars","cpc_seminars"],["clubs","cpc_club_reports"],["outreach","teacher_outreach_reports"],["funding","additional_fund_requests"],["allocations","seminar_budget_allocations"],["expenses","seminar_expenses"]];
    for(const [key,table] of tables){try{const {data,error}=await supabase.from(table).select("*").order("created_at",{ascending:false}).limit(500);if(error)throw error;appState[key]=data||[]}catch(e){console.warn(table,e.message);appState[key]=[]}}
    appState.attachments=[]; attachmentLoadError="";
    try{
      // Do not order by created_at: older installations may not have that optional column.
      const {data,error}=await supabase.from("expense_attachments").select("*").limit(1000);
      if(error)throw error;
      appState.attachments=await Promise.all((data||[]).map(async a=>{
        try{
          if(!a.storage_path) return {...a,preview_url:null,preview_error:"Attachment record has no storage_path."};
          const {data:signed,error:se}=await supabase.storage.from("cef-private-documents").createSignedUrl(a.storage_path,3600);
          return {...a,preview_url:se?null:(signed?.signedUrl||null),preview_error:se?.message||(!signed?.signedUrl?"Supabase did not return a signed URL.":"")};
        }catch(err){return {...a,preview_url:null,preview_error:err?.message||"Could not create a signed URL."}}
      }));
      if(appState.attachments.some(a=>!a.preview_url)) attachmentLoadError="Some bill files were found, but Supabase could not open them. Check Storage policies for the cef-private-documents bucket.";
    }catch(e){
      attachmentLoadError="Could not load bill/receipt records: "+(e?.message||"Supabase denied access to expense_attachments.");
      console.warn("expense_attachments",e.message);
    }
  }
  function nav(view){activeView=view;$("#nav").querySelectorAll(".nav-item").forEach(b=>b.classList.toggle("active",b.dataset.view===view));$("#sidebar")?.classList.remove("open");$("#page-title").textContent=({dashboard:"Dashboard",seminars:"Seminar Expenses",clubs:"CPC Club Reports",outreach:"Teacher Outreach",funding:"Additional Funding Requests",myreports:"My Submissions",admin:"Administration"})[view]||"Dashboard";renderView();window.scrollTo({top:0,behavior:"smooth"})}
  function stat(label,value,note,icon){return `<article class="stat-card"><span class="stat-icon">${icon}</span><div class="stat-label">${label}</div><div class="stat-value">${value}</div><div class="stat-note">${note}</div></article>`}
  function action(title,desc,icon,view){return `<button class="action-card" data-go="${view}"><span class="action-icon">${icon}</span><span><strong>${title}</strong><small>${desc}</small></span></button>`}
  function table(headers,rows,empty){return `<div class="table-wrap"><table><thead><tr>${headers.map(h=>`<th>${h}</th>`).join("")}</tr></thead><tbody>${rows.length?rows.join(""):`<tr><td colspan="${headers.length}"><div class="empty-state"><div class="empty-icon">✧</div>${empty||"No records to show yet."}</div></td></tr>`}</tbody></table></div>`}
  function myRows(arr){return arr.filter(x=>String(x.staff_id??"")===String(profile?.id??"")||String(x.staff_profile_id??"")===String(profile?.id??"")||String(x.created_by??"")===String(currentUser?.id??""))}
  function expenseCountsAgainstBudget(expense){
    const status=String(expense?.status||"submitted").toLowerCase().replaceAll("-","_").replaceAll(" ","_");
    // A submitted/under-review/approved/paid claim uses the allocation; rejected claims do not.
    return !["rejected","declined","cancelled","canceled","void"].includes(status);
  }
  function dashboard(){
    const seminars=myRows(appState.seminars),clubs=myRows(appState.clubs),outreach=myRows(appState.outreach),funding=myRows(appState.funding),alloc=myRows(appState.allocations),expenses=myRows(appState.expenses);
    const totalBudget=alloc.reduce((s,x)=>s+Number(x.amount||0),0);
    const charged=expenses.filter(expenseCountsAgainstBudget).reduce((s,x)=>s+Number(x.amount||0),0);
    const approved=expenses.filter(x=>String(x.status||"").toLowerCase()==="approved").reduce((s,x)=>s+Number(x.amount||0),0);
    const pending=expenses.filter(x=>!["approved","rejected","paid","declined","cancelled","canceled","void"].includes(String(x.status||"").toLowerCase())).reduce((s,x)=>s+Number(x.amount||0),0);
    const remaining=totalBudget-charged;
    const totalChildren=clubs.reduce((s,x)=>s+Number(x.children_attended||0),0),accepted=clubs.reduce((s,x)=>s+Number(x.children_accepted||0),0);
    return `<div class="welcome-banner"><h2>Welcome, ${esc(getName())} ✦</h2><p>Celebrating the Gift of Jesus. Sharing the Good News.<br>Manage CPC seminar stewardship and ministry reporting from one secure workspace.</p></div>
      <div class="stats-grid">${stat("Total allocated budget",money(totalBudget),"Initial + recorded allocations","＄")}${stat("Expenses charged to budget",money(charged),"All claims except rejected/cancelled","↘")}${stat("Remaining budget balance",money(remaining),"Allocated budget minus recorded expenses","◈")}${stat("Approved seminar expenses",money(approved),"Approved claims","✓")}${stat("Pending expense claims",money(pending),"Awaiting review","◷")}${stat("CPC seminars",seminars.length,"Seminar reports","▤")}${stat("CPC clubs",clubs.length,"Children's ministry reports","♡")}${stat("Children attending",totalChildren,"Reported CPC Club attendance","♧")}${stat("Children accepting Jesus",accepted,"Reported CPC Club responses","✧")}</div>
      <div class="section-heading"><div><h2>Quick actions</h2><p>Choose a report or request to get started.</p></div></div>
      <div class="actions-grid">${action("Submit seminar expenses","Report seminar costs and attach bills","▤","seminars")}${action("Submit CPC Club report","Record children attending and responses","♡","clubs")}${action("Teacher outreach report","Record results after teacher seminars","✧","outreach")}${action("Request additional funds","Request funding for an upcoming seminar","＋","funding")}${action("View my submissions","Review status and comments","☷","myreports")}${action("My budget","Review allocations and approved spending","＄","dashboard")}</div>
      <div class="section-heading"><div><h2>Recent submissions</h2><p>Latest seminar reports and review statuses.</p></div><button class="btn secondary" data-go="myreports">View all</button></div>
      <div class="panel">${table(["Report ID","Type","Date","Status"],[
        ...seminars.slice(0,4).map(x=>`<tr><td>${esc(reportCode("seminars",x,staffForReport(x)))}</td><td>CPC Seminar</td><td>${esc(x.seminar_date||"—")}</td><td>${statusPill(x.status)}</td></tr>`),
        ...clubs.slice(0,2).map(x=>`<tr><td>${esc(x.report_code||x.id||"—")}</td><td>CPC Club</td><td>${esc(x.club_date||"—")}</td><td>${statusPill(x.status)}</td></tr>`)
      ].slice(0,5),"Your submitted reports will appear here.")}</div>`;
  }
  function adminSectionReports(kind){
    if(!isAdmin()) return "";
    const configs={
      seminars:{title:"All Staff Seminar Reports",rows:appState.seminars,heads:["Staff / Report Code","Seminar #","Date","Area","Status","Actions"],cells:r=>[esc(reportCode("seminars",r,staffForReport(r))),esc(r.seminar_number||"—"),esc(r.seminar_date||"—"),esc(r.area||"—"),statusPill(r.status)],key:"seminars"},
      clubs:{title:"All Staff CPC Club Reports",rows:appState.clubs,heads:["Staff / Report Code","Date","Area","Children","Status","Actions"],cells:r=>[esc(reportCode("clubs",r,staffForReport(r))),esc(r.club_date||"—"),esc(r.area||"—"),esc(r.children_attended??0),statusPill(r.status)],key:"clubs"},
      outreach:{title:"All Staff Teacher Outreach Reports",rows:appState.outreach,heads:["Staff / Report Code","Teacher","Date","Area","Reached","Status","Actions"],cells:r=>[esc(reportCode("outreach",r,staffForReport(r))),esc(r.teacher_name||"—"),esc(r.reporting_date||"—"),esc(r.area||"—"),esc(r.children_reached??0),statusPill(r.status)],key:"outreach"},
      funding:{title:"All Staff Funding Requests",rows:appState.funding,heads:["Staff / Report Code","Planned Date","Area","Requested","Status","Actions"],cells:r=>[esc(reportCode("funding",r,staffForReport(r))),esc(r.planned_seminar_date||"—"),esc(r.area||"—"),esc(money(r.amount_requested)),statusPill(r.status)],key:"funding"}
    };
    const c=configs[kind]; if(!c) return "";
    const rows=c.rows.map(r=>`<tr>${c.cells(r).map(v=>`<td>${v}</td>`).join("")}<td><button class="btn secondary" data-open-report="${c.key}" data-report-id="${esc(r.id)}">View report</button> <button class="btn secondary" data-report-type="${c.key}" data-report-id="${esc(r.id)}">Print / PDF</button></td></tr>`);
    return `<section class="panel admin-record-panel" style="margin-bottom:18px"><div class="panel-head"><div><h2>${c.title}</h2><span class="muted-small">${c.rows.length} reports from all staff</span></div><button class="btn secondary" data-export="${c.key}">Export CSV</button></div>${table(c.heads,rows,"No staff reports have been submitted yet.")}</section>`;
  }
  function formView(kind){
    const common=`<div class="form-panel"><h2>${({seminars:"CPC Seminar Expense Report",clubs:"CPC Club Report — Children's Ministry",outreach:"Teacher Outreach Report",funding:"Additional CPC Seminar Funds Request"})[kind]}</h2><p class="intro">Fields marked * are required. Submitted records are subject to administrator review. Financial totals must be verified by the trusted database workflow.</p>`;
    let fields="";
    if(kind==="seminars")fields=`<form id="record-form" class="form-grid" data-kind="seminars">
      <label>CPC Seminar Number *<input name="seminar_number" required maxlength="80"></label><label>Seminar date *<input type="date" name="seminar_date" required></label>
      <label>Area *<input name="area" required></label><label>Village or venue<input name="venue"></label>
      <label>Teachers attended *<input type="number" name="teachers_attended" min="0" step="1" required></label><label>Accompanying CEF staff<input name="accompanying_staff"></label>
      <label class="wide">Role of accompanying staff<input name="accompanying_role"></label>
      <div class="wide expense-builder"><h3>Expense entries</h3><p class="muted-small">Every claimed amount above zero requires bill/receipt proof. You may add multiple entries.</p><div id="expense-entries"><div class="expense-row"><label>Category *<select name="expense_category[]" required><option value="travel">Travel</option><option value="refreshments">Refreshments and food</option><option value="other">Other approved seminar expense</option></select></label><label>Description *<input name="expense_description[]" required></label><label>Amount (PKR) *<input name="expense_amount[]" type="number" min="0" step="0.01" required></label><label>Bill/receipt *<input class="file-input" name="expense_bill[]" type="file" accept=".jpg,.jpeg,.png,.pdf"></label></div></div><button type="button" id="add-expense" class="btn secondary">＋ Add another expense</button></div>
      <label class="wide">Additional notes<textarea name="notes"></textarea></label>
      <div class="wide"><label><input type="checkbox" name="exception_no_bill" style="display:inline;width:auto;margin-right:8px">I need to explain an expense without a conventional bill</label><textarea name="exception_explanation" placeholder="Explain the exceptional expense and alternative evidence, if applicable"></textarea></div>
      <div class="wide form-actions"><button type="button" class="btn secondary" data-go="dashboard">Cancel</button><button class="btn primary" type="submit">Submit for review →</button></div></form>`;
    if(kind==="clubs")fields=`<form id="record-form" class="form-grid" data-kind="clubs"><label>Club date *<input type="date" name="club_date" required></label><label>Area *<input name="area" required></label><label>Village or location<input name="location"></label><label>Number of CPC Clubs *<input type="number" name="clubs_conducted" min="1" required></label><label>Total children attending *<input type="number" name="children_attended" min="0" required></label><label>Children who accepted Jesus Christ *<input type="number" name="children_accepted" min="0" required></label><label class="wide">Teachers or volunteers involved<input name="volunteers"></label><label class="wide">Remarks<textarea name="remarks"></textarea></label><label class="wide">Optional activity photographs<input class="file-input" type="file" name="activity_photos" accept=".jpg,.jpeg,.png" multiple></label><div class="wide form-actions"><button type="button" class="btn secondary" data-go="dashboard">Cancel</button><button class="btn primary" type="submit">Submit CPC Club report →</button></div></form>`;
    if(kind==="outreach")fields=`<form id="record-form" class="form-grid" data-kind="outreach"><label>Related CPC Seminar Number<input name="seminar_number"></label><label>Teacher name *<input name="teacher_name" required></label><label>Teacher's school, church, or ministry<input name="teacher_ministry"></label><label>Area *<input name="area" required></label><label>Village<input name="village"></label><label>Reporting date *<input type="date" name="reporting_date" required></label><label>Number of children reached *<input type="number" name="children_reached" min="0" required></label><label>Children who accepted Jesus Christ *<input type="number" name="children_accepted" min="0" required></label><label class="wide">Reporting scope *<select name="result_scope" required><option value="new">New results for this period</option><option value="cumulative">Cumulative results</option></select></label><label class="wide">Remarks or supporting evidence<textarea name="remarks"></textarea></label><div class="wide form-actions"><button type="button" class="btn secondary" data-go="dashboard">Cancel</button><button class="btn primary" type="submit">Submit outreach report →</button></div></form>`;
    if(kind==="funding")fields=`<form id="record-form" class="form-grid" data-kind="funding"><label>Planned seminar date *<input type="date" name="planned_seminar_date" required></label><label>Proposed area *<input name="area" required></label><label>Venue<input name="venue"></label><label>Expected number of teachers *<input type="number" name="expected_teachers" min="1" required></label><label>Estimated travel expenses (PKR) *<input type="number" name="estimated_travel" min="0" step="0.01" required></label><label>Estimated refreshments/food (PKR) *<input type="number" name="estimated_refreshments" min="0" step="0.01" required></label><label>Other planned expenses (PKR) *<input type="number" name="estimated_other" min="0" step="0.01" required></label><label>Amount requested from CEF (PKR) *<input type="number" name="amount_requested" min="0.01" step="0.01" required></label><label class="wide">Seminar objectives *<textarea name="objectives" required></textarea></label><label class="wide">Reason additional funds are needed *<textarea name="reason" required></textarea></label><label class="wide">Supporting estimates or quotations<input class="file-input" type="file" name="quotations" accept=".jpg,.jpeg,.png,.pdf" multiple></label><div class="wide form-actions"><button type="button" class="btn secondary" data-go="dashboard">Cancel</button><button class="btn primary" type="submit">Submit funding request →</button></div></form>`;
    return (isAdmin()?adminSectionReports(kind):"")+common+fields+"</div>";
  }
  function reportsView(){
    const types=[
      ["CPC Seminars",myRows(appState.seminars).map(x=>`<tr><td>${esc(reportCode("seminars",x,staffForReport(x)))}</td><td>${esc(x.seminar_number||"—")}</td><td>${esc(x.seminar_date||"—")}</td><td>${esc(x.area||"—")}</td><td>${statusPill(x.status)}</td><td><button class="btn secondary" data-open-report="seminars" data-report-id="${esc(x.id)}">View details</button> <button class="btn secondary" data-report-type="seminars" data-report-id="${esc(x.id)}">Download report</button></td></tr>`),["Report ID","Seminar #","Date","Area","Status","Download"],"seminars"],
      ["CPC Clubs",myRows(appState.clubs).map(x=>`<tr><td>${esc(reportCode("clubs",x,staffForReport(x)))}</td><td>${esc(x.club_date||"—")}</td><td>${esc(x.area||"—")}</td><td>${esc(x.children_attended??0)}</td><td>${statusPill(x.status)}</td><td><button class="btn secondary" data-open-report="clubs" data-report-id="${esc(x.id)}">View details</button> <button class="btn secondary" data-report-type="clubs" data-report-id="${esc(x.id)}">Download report</button></td></tr>`),["Report ID","Date","Area","Children","Status","Download"],"clubs"],
      ["Teacher Outreach",myRows(appState.outreach).map(x=>`<tr><td>${esc(reportCode("outreach",x,staffForReport(x)))}</td><td>${esc(x.teacher_name||"—")}</td><td>${esc(x.reporting_date||"—")}</td><td>${esc(x.children_reached??0)}</td><td>${statusPill(x.status)}</td><td><button class="btn secondary" data-open-report="outreach" data-report-id="${esc(x.id)}">View details</button> <button class="btn secondary" data-report-type="outreach" data-report-id="${esc(x.id)}">Download report</button></td></tr>`),["Report ID","Teacher","Date","Reached","Status","Download"],"outreach"],
      ["Funding Requests",myRows(appState.funding).map(x=>`<tr><td>${esc(reportCode("funding",x,staffForReport(x)))}</td><td>${esc(x.planned_seminar_date||"—")}</td><td>${esc(x.area||"—")}</td><td>${money(x.amount_requested)}</td><td>${statusPill(x.status)}</td><td><button class="btn secondary" data-open-report="funding" data-report-id="${esc(x.id)}">View details</button> <button class="btn secondary" data-report-type="funding" data-report-id="${esc(x.id)}">Download report</button></td></tr>`),["Request ID","Planned date","Area","Requested","Status","Download"],"funding"]
    ];
    return `<div class="welcome-banner"><h2>My submissions</h2><p>View your submitted reports and review status. Download an individual CEF-branded report or export your visible submissions for Excel.</p></div>${types.map(([title,rows,heads,key])=>`<div class="panel" style="margin-bottom:16px"><div class="panel-head"><h2>${title}</h2><div style="display:flex;gap:8px;flex-wrap:wrap"><button class="btn secondary" data-export="${key}">Excel export</button><button class="btn secondary" data-go="${key}">＋ New</button></div></div>${table(heads,rows,"No "+title.toLowerCase()+" submitted yet.")}</div>`).join("")}`;
  }
  function adminView(){
    if(!isAdmin())return `<div class="panel"><h2>Administrator access required</h2><p class="muted-small">Your account does not have the administrator role.</p></div>`;
    const q=String($("#admin-search")?.value||"").trim().toLowerCase();
    const staffName=id=>{const p=appState.staff.find(x=>x.id===id);return p?.full_name||p?.name||p?.staff_code||id||"—"};
    const matches=x=>!q||Object.values(x||{}).some(v=>String(v??"").toLowerCase().includes(q))||staffName(x.staff_id).toLowerCase().includes(q);
    const filtered=key=>(appState[key]||[]).filter(matches);
    const pendingExpenses=appState.expenses.filter(x=>!['approved','rejected','paid'].includes(String(x.status||'').toLowerCase()));
    const pendingFunding=appState.funding.filter(x=>!['approved','rejected','funds-allocated','paid'].includes(String(x.status||'').toLowerCase()));
    const totalExpenses=appState.expenses.filter(expenseCountsAgainstBudget).reduce((a,x)=>a+Number(x.amount||0),0);
    const totalApproved=appState.expenses.filter(x=>String(x.status||'').toLowerCase()==='approved').reduce((a,x)=>a+Number(x.amount||0),0);
    const totalRequested=appState.funding.reduce((a,x)=>a+Number(x.amount_requested||0),0);
    const totalAllocated=appState.allocations.reduce((a,x)=>a+Number(x.amount||0),0);
    const totalRemaining=totalAllocated-totalExpenses;
    const staffBudgetRows=appState.staff.filter(x=>x.id).map(st=>{
      const staffAllocations=appState.allocations.filter(a=>String(a.staff_id)===String(st.id));
      const staffExpenses=appState.expenses.filter(e=>String(e.staff_id)===String(st.id)&&expenseCountsAgainstBudget(e));
      const allocated=staffAllocations.reduce((sum,a)=>sum+Number(a.amount||0),0);
      const spent=staffExpenses.reduce((sum,e)=>sum+Number(e.amount||0),0);
      return {st,allocated,spent,remaining:allocated-spent};
    }).filter(x=>x.allocated!==0||x.spent!==0);
    const recordRows=(key,fields)=>filtered(key).map(x=>{
      const cells=fields.map(f=>`<td>${f==='staff'?esc(staffName(x.staff_id)):f==='status'?statusPill(x.status):f==='amount'?money(x.amount):f==='amount_requested'?money(x.amount_requested):f==='created_at'?esc(x.created_at?new Date(x.created_at).toLocaleString():'—'):esc(x[f]??'—')}</td>`).join('');
      const files=key==='expenses'?appState.attachments.filter(a=>String(a.expense_id)===String(x.id)):[];
      const billCell=key==='expenses'?`<td>${files.length?files.map(a=>a.preview_url?`<a class="bill-table-link" href="${esc(a.preview_url)}" target="_blank" rel="noopener">${esc(a.file_name||'Open bill')}</a>`:`<span title="${esc(a.preview_error||attachmentLoadError)}">${esc(a.file_name||'File saved; cannot open')}</span>`).join('<br>'):'<span class="muted-small">No bill record found</span>'}</td>`:'';
      const actions=["seminars","clubs","outreach","funding"].includes(key)?`<button class="btn secondary" data-open-report="${key}" data-report-id="${esc(x.id)}">View details</button> `:key==='expenses'?`<button class="btn secondary" data-open-expense-report="${esc(x.id)}">View report</button> <button class="btn secondary" data-open-expense-bill="${esc(x.id)}">View bill</button> `:"";
      return `<tr>${cells}${billCell}<td>${actions}<button class="btn secondary" data-admin-download="${key}" data-admin-id="${esc(x.id)}">View / PDF</button></td></tr>`;
    });
    const section=(title,key,headers,fields,empty,exportKey=key)=>`<section class="panel admin-record-panel"><div class="panel-head"><div><h2>${title}</h2><span class="muted-small">${filtered(key).length} records shown · ${appState[key].length} total loaded</span></div><button class="btn secondary" data-export="${exportKey}">Export Excel-compatible CSV</button></div>${key==='expenses'&&attachmentLoadError?`<p class="attachment-warning">${esc(attachmentLoadError)}</p>`:''}${table([...headers,...(key==='expenses'?['Bill / Receipt']:[]),'Report'],recordRows(key,fields),empty)}</section>`;
    const staff=appState.staff.filter(matches);
    return `<div class="welcome-banner"><h2>Administration & Ministry Oversight</h2><p>Complete overview of staff submissions, CPC seminar expenses, children's club reports, teacher outreach, funding requests, allocations and recorded expense lines. Use search to locate a staff member, report, area, status or reference.</p></div>
      <div class="stats-grid">${stat('Registered staff',appState.staff.length,'All staff profiles visible to this account','♙')}${stat('Seminar reports',appState.seminars.length,'Submitted seminar records','▤')}${stat('CPC club reports',appState.clubs.length,'Children’s ministry reports','♡')}${stat('Teacher outreach',appState.outreach.length,'Outreach reports submitted','✧')}${stat('Funding requests',appState.funding.length,'All requests recorded','＋')}${stat('Awaiting funding decision',pendingFunding.length,'Requests not yet finalised','◷')}${stat('Total allocated budget',money(totalAllocated),'All staff budget allocations','＄')}${stat('Expenses charged to budget',money(totalExpenses),'All claims except rejected/cancelled','↘')}${stat('Remaining budget balance',money(totalRemaining),'Total allocations minus charged expenses','◈')}${stat('Pending expense lines',pendingExpenses.length,'Claims awaiting review','◷')}</div>
      <div class="panel admin-search-panel"><div class="panel-head"><div><h2>Search all administration records</h2><p class="muted-small">Search applies to the staff directory and every report/request table below.</p></div><button class="btn secondary" id="admin-refresh" type="button">↻ Refresh all data</button></div><input id="admin-search" type="search" value="${esc(q)}" placeholder="Search staff name, staff code, area, report ID, status, date, amount…" aria-label="Search all records"><div class="admin-summary-line"><span><b>Total expenses recorded:</b> ${money(totalExpenses)}</span><span><b>Approved expenses:</b> ${money(totalApproved)}</span><span><b>Funding requested:</b> ${money(totalRequested)}</span><span><b>Budget allocations:</b> ${money(totalAllocated)}</span></div></div>
      <section class="panel admin-record-panel"><div class="panel-head"><div><h2>Complete Staff Directory</h2><span class="muted-small">${staff.length} staff matching search</span></div><button class="btn secondary" data-export="staff">Export staff CSV</button></div>${table(['Staff Name','Staff Code','Email','Phone','City','Region','State','Role','Active','Joined'],staff.map(x=>`<tr><td>${esc(x.full_name||x.name||'—')}</td><td>${esc(x.staff_code||'—')}</td><td>${esc(x.email||'—')}</td><td>${esc(x.phone||'—')}</td><td>${esc(x.city||'—')}</td><td>${esc(x.region||'—')}</td><td>${esc(x.state||'—')}</td><td>${esc(titleCase(x.role||'staff'))}</td><td>${esc(x.active===false?'No':'Yes')}</td><td>${esc(x.created_at?new Date(x.created_at).toLocaleDateString():'—')}</td></tr>`),'No staff profiles found.')}</section>
      <section class="panel admin-record-panel"><div class="panel-head"><div><h2>Staff Budget Balances</h2><p class="muted-small">Remaining balance is calculated as each staff member’s total allocation minus expense claims, excluding rejected or cancelled claims. CPC Club reports do not affect this balance.</p></div><button class="btn secondary" data-export="allocations">Export allocations CSV</button></div>${table(['Staff member','Staff code','Original allocated amount','Expenses charged','Remaining balance'],staffBudgetRows.map(x=>`<tr><td>${esc(x.st.full_name||x.st.name||'—')}</td><td>${esc(x.st.staff_code||'—')}</td><td>${esc(money(x.allocated))}</td><td>${esc(money(x.spent))}</td><td><strong>${esc(money(x.remaining))}</strong></td></tr>`),'No staff budget allocations or expenses found.')}</section>
      ${section('CPC Seminar Reports','seminars',['Staff','Seminar #','Date','Area','Venue','Teachers attended','Status','Submitted'],['staff','seminar_number','seminar_date','area','venue','teachers_attended','status','created_at'],'No seminar reports found.')}
      ${section('Seminar Expense Claims / Receipts','expenses',['Staff','Seminar ID','Category','Description','Amount','Status','Submitted'],['staff','seminar_id','category','description','amount','status','created_at'],'No seminar expense lines found.')}
      ${section('CPC Club Reports — Children’s Ministry','clubs',['Staff','Report date','Area','Venue','Children attended','Accepted Jesus','Status','Submitted'],['staff','club_date','area','venue','children_attended','children_accepted','status','created_at'],'No CPC club reports found.')}
      ${section('Teacher Outreach Reports','outreach',['Staff','Teacher / Contact','Report date','Area','Children reached','Accepted Jesus','Status','Submitted'],['staff','teacher_name','reporting_date','area','children_reached','children_accepted','status','created_at'],'No teacher outreach reports found.')}
      ${section('Additional CPC Seminar Funding Requests','funding',['Staff','Planned date','Area','Venue','Amount requested','Purpose','Status','Submitted'],['staff','planned_seminar_date','area','venue','amount_requested','purpose','status','created_at'],'No funding requests found.')}
      ${section('Seminar Budget Allocations','allocations',['Staff','Seminar ID','Amount','Status','Notes','Created'],['staff','seminar_id','amount','status','notes','created_at'],'No budget allocations found.')}
      <section class="panel admin-record-panel" id="budget-allocation-panel">
        <div class="panel-head"><div><h2>Allocate budget to staff</h2><p class="muted-small">Record a staff budget allocation in the existing budget allocations table.</p></div></div>
        <form id="budget-allocation-form" class="form-grid">
          <label>Staff member *<select name="staff_id" required><option value="">Choose staff member</option>${appState.staff.filter(x=>x.id).map(x=>`<option value="${esc(x.id)}">${esc(x.full_name||x.name||x.staff_code||x.id)}${x.staff_code?' · '+esc(x.staff_code):''}</option>`).join('')}</select></label>
          <label>Budget amount (PKR) *<input name="amount" type="number" min="0.01" step="0.01" required></label>
          <label>Seminar ID (optional)<input name="seminar_id" placeholder="Existing seminar ID, if applicable"></label>
          <label>Allocation status<select name="status"><option value="allocated">Allocated</option><option value="approved">Approved</option></select></label>
          <label class="wide">Notes<textarea name="notes" placeholder="Purpose or allocation notes"></textarea></label>
          <div class="wide form-actions"><button class="btn primary" type="submit">Save staff allocation</button></div>
        </form>
      </section>
      <div class="panel admin-note"><h2>Review and access notes</h2><p class="muted-small">Report visibility and budget actions depend on the Supabase permissions configured for this project. This change uses the existing budget allocations table and does not change other portal workflows.</p></div>`;
  }
  function reportDetailView(){
    const kinds={seminars:["CPC Seminar Report",appState.seminars],clubs:["CPC Club Report",appState.clubs],outreach:["Teacher Outreach Report",appState.outreach],funding:["Additional Funding Request",appState.funding]};
    const info=kinds[openedReport?.kind];if(!info)return `<div class="panel"><p>Report not found.</p><button class="btn secondary" data-go="${isAdmin()?'admin':'myreports'}">Back</button></div>`;
    const r=info[1].find(x=>String(x.id)===String(openedReport.id));
    if(!r)return `<div class="panel"><h2>Report not found</h2><p class="muted-small">This report is not available in the records visible to your account.</p><button class="btn secondary" data-go="${isAdmin()?'admin':'myreports'}">Back to reports</button></div>`;
    if(!isAdmin()&&r.staff_id!==profile?.id&&r.staff_profile_id!==profile?.id&&r.created_by!==currentUser?.id)return `<div class="panel"><h2>Access restricted</h2><p class="muted-small">You can only view your own submissions.</p><button class="btn secondary" data-go="myreports">Back to my submissions</button></div>`;
    const staff=staffForReport(r);
    const fields=Object.entries(r).filter(([k,v])=>!['id','staff_id','staff_profile_id','created_by','report_code','request_code'].includes(k)&&v!==null&&v!=="");
    const expenses=openedReport.kind==="seminars"?appState.expenses.filter(x=>String(x.seminar_id)===String(r.id)):[];
    const attachments=openedReport.kind==="seminars"?appState.attachments.filter(a=>String(a.seminar_id)===String(r.id)):[];
    const label=info[0];
    const code=reportCode(openedReport.kind,r,staff);
    return `<div class="report-detail-hero"><div><div class="eyebrow">CEF · CPC SUBMISSION</div><h2>${esc(label)}</h2><p>Complete report details and current review status.</p></div><div>${statusPill(r.status)}</div></div>
      <div class="report-detail-actions"><button class="btn secondary" data-go="${isAdmin()?'admin':'myreports'}">← Back to reports</button><button class="btn primary" data-report-type="${esc(openedReport.kind)}" data-report-id="${esc(r.id)}">Print / Save PDF</button></div>
      <section class="panel report-detail-panel"><h2>Submission overview</h2><div class="report-detail-grid"><div><span>Staff member</span><strong>${esc(staff?.full_name||staff?.name||staff?.staff_code|| (r.staff_id===profile?.id?getName():"Staff record"))}</strong></div><div><span>Report code</span><strong>${esc(code)}</strong></div><div><span>Submitted</span><strong>${esc(r.created_at?new Date(r.created_at).toLocaleString():"—")}</strong></div><div><span>Status</span><strong>${statusPill(r.status)}</strong></div></div></section>
      <section class="panel report-detail-panel"><h2>Report information</h2><dl class="report-fields">${fields.map(([k,v])=>`<dt>${esc(titleCase(k))}</dt><dd>${esc(typeof v==='object'?JSON.stringify(v):String(v))}</dd>`).join("")}</dl></section>
      ${openedReport.kind==="seminars"?`<section class="panel report-detail-panel"><h2>Expense details</h2>${table(["Category","Description","Amount","Status","Bill / Receipt"],expenses.map(e=>{const files=attachments.filter(a=>String(a.expense_id)===String(e.id));return `<tr><td>${esc(titleCase(e.category))}</td><td>${esc(e.description||"—")}</td><td>${esc(money(e.amount))}</td><td>${statusPill(e.status)}</td><td>${files.length?files.map(a=>a.preview_url?`<a href="${esc(a.preview_url)}" target="_blank" rel="noopener">${esc(a.file_name||"Open bill")}</a>`:esc(a.file_name||"Uploaded bill (preview unavailable)")).join("<br>"):"No bill attached"}</td></tr>`}),"No expense lines are available for this report.")}<div class="report-detail-total">Total claimed: ${esc(money(expenses.reduce((a,e)=>a+Number(e.amount||0),0)))}</div><h3>Bill / receipt pictures</h3><div class="bill-preview-grid">${attachments.map(a=>a.preview_url&&String(a.content_type||"").startsWith("image/")?`<a class="bill-preview" href="${esc(a.preview_url)}" target="_blank" rel="noopener"><img src="${esc(a.preview_url)}" alt="${esc(a.file_name||"Expense bill")}"><span>${esc(a.file_name||"View bill")}</span></a>`:`<a class="bill-file-link" href="${esc(a.preview_url||"#")}" target="_blank" rel="noopener">${esc(a.file_name||"Open receipt document")}</a>`).join("")||'<p class="muted-small">No bill pictures are available. Confirm that expense attachments were uploaded and are visible under Supabase policies.</p>'}</div></section>`:""}`;
  }
  function expenseDetailView(){
    const e=appState.expenses.find(x=>String(x.id)===String(openedExpenseId));
    if(!e) return `<div class="panel"><h2>Expense report not found</h2><p class="muted-small">The expense may not be visible to this account or may have been removed.</p><button class="btn secondary" data-go="admin">Back to administration</button></div>`;
    if(!isAdmin() && e.staff_id!==profile?.id && e.created_by!==currentUser?.id) return `<div class="panel"><h2>Access restricted</h2><p>You can only view your own expense reports.</p><button class="btn secondary" data-go="myreports">Back</button></div>`;
    const staff=staffForReport(e), files=appState.attachments.filter(a=>String(a.expense_id)===String(e.id));
    const seminar=appState.seminars.find(r=>String(r.id)===String(e.seminar_id));
    const fileMarkup=files.length?files.map(a=>a.preview_url&&String(a.content_type||"").startsWith("image/")?`<a class="bill-preview" href="${esc(a.preview_url)}" target="_blank" rel="noopener"><img src="${esc(a.preview_url)}" alt="${esc(a.file_name||"Expense bill")}"><span>${esc(a.file_name||"Open bill")}</span></a>`:`<a class="bill-file-link" href="${esc(a.preview_url||"#")}" target="_blank" rel="noopener">${esc(a.file_name||"Open receipt document")}${a.preview_url?"":" (unavailable)"}</a>`).join(""):`<p class="muted-small">No bill attachment is linked to this expense. ${esc(attachmentLoadError)}</p>`;
    return `<div class="report-detail-hero"><div><div class="eyebrow">CEF · EXPENSE CLAIM</div><h2>Expense Report</h2><p>Expense claim and bill/receipt evidence.</p></div><div>${statusPill(e.status)}</div></div><div class="report-detail-actions"><button class="btn secondary" data-go="admin">← Back to Administration</button>${seminar?`<button class="btn secondary" data-open-report="seminars" data-report-id="${esc(seminar.id)}">Open linked seminar report</button>`:""}<button class="btn primary" id="print-expense-detail">Print / Save PDF</button></div><section class="panel report-detail-panel"><h2>Expense information</h2><div class="report-detail-grid"><div><span>Staff member</span><strong>${esc(staff?.full_name||staff?.name||staff?.staff_code||"Staff record")}</strong></div><div><span>Staff code</span><strong>${esc(staff?.staff_code||"—")}</strong></div><div><span>Seminar ID</span><strong>${esc(e.seminar_id||"—")}</strong></div><div><span>Category</span><strong>${esc(titleCase(e.category))}</strong></div><div><span>Description</span><strong>${esc(e.description||"—")}</strong></div><div><span>Amount</span><strong>${esc(money(e.amount))}</strong></div><div><span>Submitted</span><strong>${esc(e.created_at?new Date(e.created_at).toLocaleString():"—")}</strong></div><div><span>Status</span><strong>${statusPill(e.status)}</strong></div></div></section><section class="panel report-detail-panel"><h2>Submitted bills / receipts</h2><div class="bill-preview-grid">${fileMarkup}</div>${attachmentLoadError?`<p class="attachment-warning">${esc(attachmentLoadError)}</p>`:""}</section>`;
  }
  function renderView(){
    const root=$("#view-container");if(!root)return;
    if(activeView==="dashboard")root.innerHTML=dashboard();
    else if(["seminars","clubs","outreach","funding"].includes(activeView))root.innerHTML=formView(activeView);
    else if(activeView==="myreports")root.innerHTML=reportsView();
    else if(activeView==="admin")root.innerHTML=adminView();
    else if(activeView==="report-detail")root.innerHTML=reportDetailView();
    else if(activeView==="expense-detail")root.innerHTML=expenseDetailView();
    bindViewEvents();
  }
  async function uploadFile(file,bucket,path){if(!file)return null;const allowed=["image/jpeg","image/png","application/pdf"];if(!allowed.includes(file.type))throw new Error("Only JPG, PNG, and PDF uploads are allowed.");if(file.size>10*1024*1024)throw new Error("Each file must be 10 MB or smaller.");const {data,error}=await supabase.storage.from(bucket).upload(path,file,{upsert:false,contentType:file.type});if(error)throw error;return data.path}
  async function submitRecord(e){
    e.preventDefault();const form=e.currentTarget,kind=form.dataset.kind,fd=new FormData(form);const payload={staff_id:profile?.id,created_by:currentUser.id,status:"submitted"};
    const fields=Object.fromEntries(fd.entries());delete fields["expense_bill[]"];delete fields["expense_category[]"];delete fields["expense_description[]"];delete fields["expense_amount[]"];
    try{
      if(!profile)throw new Error("Your staff profile is not linked. Contact the CEF administrator.");
      if(kind==="clubs"&&Number(fields.children_accepted)>Number(fields.children_attended))throw new Error("Children who accepted Jesus Christ cannot exceed the number attending.");
      if(kind==="outreach"&&Number(fields.children_accepted)>Number(fields.children_reached))throw new Error("Children who accepted Jesus Christ cannot exceed children reached.");
      if(kind==="seminars"){
        const categories=fd.getAll("expense_category[]"),descs=fd.getAll("expense_description[]"),amounts=fd.getAll("expense_amount[]"),bills=form.querySelectorAll('input[name="expense_bill[]"]');
        const entries=[];
        for(let i=0;i<categories.length;i++){const amount=Number(amounts[i]||0);if(amount>0&&!bills[i]?.files?.[0])throw new Error("A bill or receipt is required for every expense above zero.");entries.push({category:categories[i],description:descs[i],amount,file:bills[i]?.files?.[0]||null})}
        if(!entries.length)throw new Error("Add at least one expense entry.");
        const {data:seminar,error}=await supabase.from("cpc_seminars").insert({staff_id:profile.id,created_by:currentUser.id,seminar_number:fields.seminar_number,seminar_date:fields.seminar_date,area:fields.area,venue:fields.venue||null,teachers_attended:Number(fields.teachers_attended),accompanying_staff:fields.accompanying_staff||null,accompanying_role:fields.accompanying_role||null,notes:fields.notes||null,status:"submitted"}).select().single();
        if(error)throw error;
        for(const entry of entries){let path=null;if(entry.file)path=await uploadFile(entry.file,"cef-private-documents",`${currentUser.id}/${seminar.id}/${crypto.randomUUID()}-${entry.file.name.replace(/[^a-zA-Z0-9._-]/g,"_")}`);
          const {data:expense,error:ee}=await supabase.from("seminar_expenses").insert({seminar_id:seminar.id,staff_id:profile.id,created_by:currentUser.id,category:entry.category,description:entry.description,amount:entry.amount,status:"submitted"}).select("id").single();
          if(ee)throw ee;
          if(path){
            const {error:ae}=await supabase.from("expense_attachments").insert({seminar_id:seminar.id,staff_id:profile.id,expense_id:expense.id,storage_path:path,file_name:entry.file.name,content_type:entry.file.type,uploaded_by:currentUser.id});
            if(ae)throw ae;
          }
        }
      }else{
        const table=({clubs:"cpc_club_reports",outreach:"teacher_outreach_reports",funding:"additional_fund_requests"})[kind];
        if(kind==="clubs"){payload.club_date=fields.club_date;payload.area=fields.area;payload.location=fields.location||null;payload.clubs_conducted=Number(fields.clubs_conducted);payload.children_attended=Number(fields.children_attended);payload.children_accepted=Number(fields.children_accepted);payload.volunteers=fields.volunteers||null;payload.remarks=fields.remarks||null}
        if(kind==="outreach"){payload.seminar_number=fields.seminar_number||null;payload.teacher_name=fields.teacher_name;payload.teacher_ministry=fields.teacher_ministry||null;payload.area=fields.area;payload.village=fields.village||null;payload.reporting_date=fields.reporting_date;payload.children_reached=Number(fields.children_reached);payload.children_accepted=Number(fields.children_accepted);payload.result_scope=fields.result_scope;payload.remarks=fields.remarks||null}
        if(kind==="funding"){payload.planned_seminar_date=fields.planned_seminar_date;payload.area=fields.area;payload.venue=fields.venue||null;payload.expected_teachers=Number(fields.expected_teachers);payload.estimated_travel=Number(fields.estimated_travel);payload.estimated_refreshments=Number(fields.estimated_refreshments);payload.estimated_other=Number(fields.estimated_other);payload.amount_requested=Number(fields.amount_requested);payload.objectives=fields.objectives;payload.reason=fields.reason;payload.status="submitted"}
        const {error}=await supabase.from(table).insert(payload);if(error)throw error;
      }
      toast("Report submitted successfully for review.");await loadData();nav("myreports");
    }catch(err){console.error(err);toast(err.message||"Submission failed.",true)}
  }
  function downloadCsv(kind){const arr=kind==="staff"?(isAdmin()?appState.staff:[]):(isAdmin()?(appState[kind]||[]):myRows(appState[kind]||[]));if(!arr.length){toast("There are no records to export.",true);return}const staffName=getName(),staffCode=profile?.staff_code||"",keys=[...new Set(arr.flatMap(x=>Object.keys(x)))];const cell=v=>`"${String(v??"").replaceAll('"','""')}"`;const csv=["CEF - CHILD EVANGELISM FELLOWSHIP",`Staff Name,${cell(staffName)}`,`Staff Code,${cell(staffCode)}`,`Email,${cell(currentUser?.email||"")}`,`Report Category,${cell(titleCase(kind))}`,`Exported On,${cell(new Date().toLocaleString())}`,"",keys.map(cell).join(","),...arr.map(x=>keys.map(k=>cell(x[k])).join(","))].join("\r\n");const blob=new Blob(["\ufeff"+csv],{type:"text/csv;charset=utf-8;"});const a=document.createElement("a");a.href=URL.createObjectURL(blob);a.download=`CEF-${kind}-${(profile?.staff_code||"staff").replace(/[^a-z0-9_-]/gi,"")}-${new Date().toISOString().slice(0,10)}.csv`;a.click();setTimeout(()=>URL.revokeObjectURL(a.href),1000)}
  function downloadBrandedReport(kind,id){
    const list=({seminars:appState.seminars,clubs:appState.clubs,outreach:appState.outreach,funding:appState.funding})[kind]||[];
    const r=list.find(x=>String(x.id)===String(id));if(!r){toast("Report not found in your visible submissions.",true);return}
    if(!isAdmin()&&r.staff_id!==profile?.id&&r.created_by!==currentUser?.id){toast("You can only download your own report.",true);return}
    const labels={seminars:"CPC Seminar Expense Report",clubs:"CPC Club Report",outreach:"Teacher Outreach Report",funding:"Additional Funding Request"};
    const fields=Object.entries(r).filter(([k,v])=>!['id','staff_id','created_by'].includes(k)&&v!==null&&v!=="");
    let extra="";
    if(kind==="seminars") {const expenses=appState.expenses.filter(e=>e.seminar_id===r.id);extra=`<h2>Expense Details</h2><table><thead><tr><th>Category</th><th>Description</th><th>Amount</th><th>Status</th></tr></thead><tbody>${expenses.map(e=>`<tr><td>${esc(titleCase(e.category))}</td><td>${esc(e.description)}</td><td>${esc(money(e.amount))}</td><td>${esc(titleCase(e.status))}</td></tr>`).join("")||'<tr><td colspan="4">Expense details are not available to this account.</td></tr>'}</tbody></table><p class="total"><b>Total claimed:</b> ${esc(money(expenses.reduce((a,e)=>a+Number(e.amount||0),0)))}</p>`;}
    const staff=staffForReport(r);
    const code=reportCode(kind,r,staff);
    const reportStaffName=staff?.full_name||staff?.name||staff?.staff_code||"Staff record";
    const reportStaffEmail=staff?.email||"—";
    const logo=new URL('assets/cef-logo.jpg',location.href).href;
    const html=`<!doctype html><html><head><meta charset="utf-8"><title>${esc(labels[kind]||"CEF Report")}</title><style>body{font:14px Arial,sans-serif;color:#24372c;margin:32px}header{display:flex;align-items:center;gap:18px;border-bottom:4px solid #c9a45c;padding-bottom:16px;margin-bottom:22px}header img{width:95px;height:auto;object-fit:contain}h1{color:#123f2d;font-size:22px;margin:0 0 6px}h2{font-size:17px;color:#123f2d;margin-top:25px}.sub{color:#647469;font-size:12px}table{width:100%;border-collapse:collapse;margin-top:10px}th{background:#123f2d;color:white;text-align:left}th,td{border:1px solid #d8e1d9;padding:9px;font-size:12px}dl{display:grid;grid-template-columns:220px 1fr;gap:0;margin:0}dt,dd{padding:9px;border-bottom:1px solid #e3e9e3;margin:0;overflow-wrap:anywhere}dt{font-weight:bold;background:#f3f7f3}.total{font-size:16px;color:#123f2d;margin-top:18px}.footer{border-top:1px solid #d8e1d9;margin-top:35px;padding-top:12px;font-size:10px;color:#718077}.actions{margin-bottom:20px}@media print{body{margin:14mm}.actions{display:none}header{-webkit-print-color-adjust:exact;print-color-adjust:exact}th{print-color-adjust:exact;-webkit-print-color-adjust:exact}}</style></head><body><div class="actions"><button onclick="window.print()">Print / Save as PDF</button></div><header><img src="${logo}" alt="CEF logo"><div><h1>CHILD EVANGELISM FELLOWSHIP (CEF)</h1><div><b>${esc(labels[kind]||"Report")}</b></div><div class="sub">Official staff submission record</div></div></header><h2>Staff Information</h2><dl><dt>Staff Name</dt><dd>${esc(reportStaffName)}</dd><dt>Staff Code</dt><dd>${esc(staff?.staff_code||"—")}</dd><dt>Staff Email</dt><dd>${esc(reportStaffEmail)}</dd><dt>Report Code</dt><dd>${esc(code)}</dd><dt>Area / City</dt><dd>${esc(staff?.area||staff?.city||r.area||"—")}</dd><dt>Region / State</dt><dd>${esc([staff?.region,staff?.state].filter(Boolean).join(" / ")||"—")}</dd></dl><h2>Report Information</h2><dl>${fields.map(([k,v])=>`<dt>${esc(titleCase(k))}</dt><dd>${esc(typeof v==='object'?JSON.stringify(v):String(v))}</dd>`).join("")}</dl>${extra}<div class="footer">CEF • ${esc(labels[kind]||"Staff Report")} • Generated ${esc(new Date().toLocaleString())}. This report reflects the information recorded in the portal at the time of download.</div><script>window.addEventListener('load',()=>{const im=document.querySelector('header img');if(im.complete){}else im.onload=()=>{};});</script></body></html>`;
    const win=window.open("","_blank");if(!win){toast("Please allow pop-ups to download or print the report.",true);return}win.document.open();win.document.write(html);win.document.close();
  }
  function bindViewEvents(){
    document.querySelectorAll("[data-go]").forEach(b=>b.addEventListener("click",()=>nav(b.dataset.go)));
    const form=$("#record-form");if(form)form.addEventListener("submit",submitRecord);
    $("#add-expense")?.addEventListener("click",()=>{const row=document.createElement("div");row.className="expense-row";row.innerHTML=`<div class="form-grid"><label>Category *<select name="expense_category[]" required><option value="travel">Travel</option><option value="refreshments">Refreshments and food</option><option value="other">Other approved seminar expense</option></select></label><label>Description *<input name="expense_description[]" required></label><label>Amount (PKR) *<input name="expense_amount[]" type="number" min="0" step="0.01" required></label><label>Bill/receipt *<input class="file-input" name="expense_bill[]" type="file" accept=".jpg,.jpeg,.png,.pdf"></label></div><button type="button" class="text-button remove-expense">Remove this expense</button>`;$("#expense-entries").append(row);row.querySelector(".remove-expense").addEventListener("click",()=>row.remove())});
    $("#admin-search")?.addEventListener("input",()=>{const el=$("#admin-search"),pos=el.selectionStart;renderView();const next=$("#admin-search");next?.focus();next?.setSelectionRange(pos,pos)});
    $("#admin-refresh")?.addEventListener("click",async()=>{await loadData();renderView();toast("Administration data refreshed.")});
    document.querySelectorAll("[data-open-report]").forEach(b=>b.addEventListener("click",()=>{
      openedReport={kind:b.dataset.openReport,id:b.dataset.reportId};
      activeView="report-detail";
      $("#nav").querySelectorAll(".nav-item").forEach(n=>n.classList.remove("active"));
      $("#page-title").textContent="Report Details";
      renderView();window.scrollTo({top:0,behavior:"smooth"});
    }));
    $("#budget-allocation-form")?.addEventListener("submit",async e=>{
      e.preventDefault();if(!isAdmin()){toast("Administrator access required.",true);return}
      const fd=new FormData(e.currentTarget);
      const amount=Number(fd.get("amount"));
      if(!Number.isFinite(amount)||amount<=0){toast("Enter a budget amount greater than zero.",true);return}
      const record={staff_id:String(fd.get("staff_id")),allocation_type:"initial",amount,status:String(fd.get("status")||"allocated"),notes:String(fd.get("notes")||"").trim()||null};
      const seminarId=String(fd.get("seminar_id")||"").trim();if(seminarId)record.seminar_id=seminarId;
      try{
        const {error}=await supabase.from("seminar_budget_allocations").insert(record);
        if(error)throw error;
        toast("Staff budget allocation saved.");await loadData();renderView();
      }catch(err){console.error(err);toast("Could not save allocation: "+(err.message||"Check Supabase table fields and admin permissions."),true)}
    });
    document.querySelectorAll("[data-open-expense-report]").forEach(b=>b.addEventListener("click",()=>{
      openedExpenseId=b.dataset.openExpenseReport;activeView="expense-detail";
      $("#nav").querySelectorAll(".nav-item").forEach(n=>n.classList.remove("active"));
      $("#page-title").textContent="Expense Report Details";renderView();window.scrollTo({top:0,behavior:"smooth"});
    }));
    $("#print-expense-detail")?.addEventListener("click",()=>window.print());
    document.querySelectorAll("[data-open-expense-bill]").forEach(b=>b.addEventListener("click",()=>{
      const files=appState.attachments.filter(a=>String(a.expense_id)===String(b.dataset.openExpenseBill));
      const usable=files.find(a=>a.preview_url);
      if(usable){window.open(usable.preview_url,"_blank","noopener");return;}
      const reason=files.map(a=>a.preview_error).filter(Boolean).join("; ")||attachmentLoadError||"No attachment record is linked to this expense. The staff member may need to upload the bill again.";
      toast("Bill is not accessible: "+reason,true);
    }));
    document.querySelectorAll("[data-admin-download]").forEach(b=>b.addEventListener("click",()=>{const kind=b.dataset.adminDownload,id=b.dataset.adminId;if(["seminars","clubs","outreach","funding"].includes(kind))downloadBrandedReport(kind,id);else if(kind==="expenses"){openedExpenseId=id;activeView="expense-detail";$("#page-title").textContent="Expense Report Details";renderView();window.scrollTo({top:0,behavior:"smooth"})}else toast("This record type does not have a printable report.",true)}));
    document.querySelectorAll("[data-export]").forEach(b=>b.addEventListener("click",()=>downloadCsv(b.dataset.export)));
    document.querySelectorAll("[data-report-type]").forEach(b=>b.addEventListener("click",()=>downloadBrandedReport(b.dataset.reportType,b.dataset.reportId)));
    ["#leader-region","#leader-city","#leader-state"].forEach(sel=>$(sel)?.addEventListener("change",()=>renderView()));
    $("#clear-leader-filters")?.addEventListener("click",()=>{["#leader-region","#leader-city","#leader-state"].forEach(sel=>{const el=$(sel);if(el)el.value=""});renderView()});
  }
  $("#setup-form").addEventListener("submit",async e=>{e.preventDefault();const url=$("#project-url").value.trim().replace(/\/$/,""),key=$("#anon-key").value.trim();if(!/^https:\/\/.+\.supabase\.co$/.test(url)){toast("Enter a valid Supabase project URL.",true);return}if(!key){toast("Enter your Supabase publishable / anon key.",true);return}localStorage.setItem(configKey,JSON.stringify({url,key}));await connectAndBoot()});
  $("#configure-button").addEventListener("click",configure);
  $("#login-form").addEventListener("submit",signIn);
  $("#signup-form").addEventListener("submit",signUp);
  $("#show-signup").addEventListener("click",()=>{$("#signup-form").classList.remove("hidden");$("#login-form").classList.add("hidden");$("#show-signup").classList.add("hidden");$("#login-message").textContent=""});
  $("#cancel-signup").addEventListener("click",()=>{$("#signup-form").classList.add("hidden");$("#login-form").classList.remove("hidden");$("#show-signup").classList.remove("hidden");$("#login-message").textContent=""});
  $("#forgot-password").addEventListener("click",resetPassword);
  $("#toggle-password").addEventListener("click",()=>{const p=$("#login-password");p.type=p.type==="password"?"text":"password";$("#toggle-password").textContent=p.type==="password"?"Show":"Hide"});
  $("#sign-out").addEventListener("click",async()=>{if(supabase)await supabase.auth.signOut();showScreen("#login-screen")});
  $("#nav").addEventListener("click",e=>{const b=e.target.closest("[data-view]");if(b)nav(b.dataset.view)});
  $("#refresh-data").addEventListener("click",async()=>{await loadData();renderView();toast("Data refreshed.")});
  $("#mobile-menu").addEventListener("click",()=>{const sb=document.querySelector(".sidebar");const opened=sb.classList.toggle("open");$("#mobile-menu").setAttribute("aria-expanded",String(opened));$("#mobile-menu").setAttribute("aria-label",opened?"Close menu":"Open menu")});
  document.addEventListener("click",e=>{const sb=document.querySelector(".sidebar");if(window.innerWidth<=780&&sb.classList.contains("open")&&!sb.contains(e.target)&&!$("#mobile-menu").contains(e.target)){sb.classList.remove("open");$("#mobile-menu").setAttribute("aria-expanded","false");$("#mobile-menu").setAttribute("aria-label","Open menu")}});
  if(!config())showScreen("#login-screen");else connectAndBoot();
})();