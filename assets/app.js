import { createClient } from "https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2/+esm";
import { SUPABASE_URL,SUPABASE_PUBLISHABLE_KEY } from "./config.js";
import { esc,fmt,route,go,roleLabel,statusBadge,readJSON,writeJSON } from "./modules/utils.js";
import { createMediaService } from "./modules/media.js";
import { createAntiCheatController } from "./modules/anti-cheat.js";
import { createExamApp } from "./app-exam.js";
import { createExamCoordinator } from "./exam/exam-coordinator.js";
import { createStaffResultsController } from "./modules/staff-results.js";
import { createAuthPages } from "./auth/auth-pages.js";
import { createDashboardController } from "./staff/dashboard.js";
import { createAccountsController } from "./staff/accounts.js";
import { createClassesController } from "./staff/classes.js";
import { createTestListController } from "./tests/test-list.js";
import { createTestCreateController } from "./tests/test-create.js";
import { createTestWorkspaceController } from "./tests/test-workspace.js";
import { createAuthoringController } from "./tests/authoring.js";
import { createQuestionBankListController } from "./question-bank/bank-list.js";
import { createQuestionBankEditorController } from "./question-bank/bank-editor.js";
import { createQuestionBankMediaService } from "./question-bank/bank-media.js";
import { createQuestionBankGeneratorController } from "./question-bank/bank-generator.js";

const sb=createClient(SUPABASE_URL,SUPABASE_PUBLISHABLE_KEY);
const {uploadMedia,signedUrl,signedUrlMap,removeMedia}=createMediaService(sb);
const bankMedia=createQuestionBankMediaService(sb);
const appView=document.querySelector("#view");
const sessionActions=document.querySelector("#sessionActions");
const staffHeaderNav=document.querySelector("#staffHeaderNav");
const toastEl=document.querySelector("#toast");
const modalRoot=document.querySelector("#modalRoot");

let view=appView;
let session=null;
let profile=null;
let passwordRecoveryMode=/(?:^|[&#])type=recovery(?:&|$)/.test(location.hash);
let liveChannel=null;
let activeStaffPageKey=null;
let staffPrefetchPromise=null;
let lastRoute=route();
const staffPageCache=new Map();
const staffDataCache={users:null,classes:null,tests:null,updatedAt:0};
const testState={workspace:null};

function toast(msg,ms=3600){toastEl.textContent=msg;toastEl.hidden=false;clearTimeout(toastEl._t);toastEl._t=setTimeout(()=>toastEl.hidden=true,ms);}
function closeModal(){modalRoot.innerHTML="";}
function showLoading(text="Đang tải..."){view.innerHTML=`<section class="card">${esc(text)}</section>`;}
function staffNav(){return "";}
function clearLiveChannel(){if(liveChannel){try{sb.removeChannel(liveChannel);}catch{}liveChannel=null;}}
function invalidateStaffData(...keys){for(const k of keys)staffDataCache[k]=null;staffDataCache.updatedAt=0;}
function getStaffDataCache(){return staffDataCache;}

function staffCacheScrollKey(key){return `toeic.staffView.${session?.user?.id||"anon"}.${key}`;}
function saveActiveStaffScroll(){if(!activeStaffPageKey)return;const entry=staffPageCache.get(activeStaffPageKey);if(!entry)return;entry.scroll=window.scrollY;writeJSON(staffCacheScrollKey(activeStaffPageKey),{scroll:entry.scroll,updated_at:Date.now()});}
function clearTransientView(){[...appView.children].forEach(el=>{if(!el.classList.contains("staff-page-cache"))el.remove();});}
function clearStaffPages(){staffPageCache.clear();activeStaffPageKey=null;appView.innerHTML="";view=appView;}
function invalidateStaffPage(key){const entry=staffPageCache.get(key);if(entry?.el)entry.el.remove();staffPageCache.delete(key);if(activeStaffPageKey===key){activeStaffPageKey=null;view=appView;}}
async function showStaffPage(key,initFn,afterShow=null){
  saveActiveStaffScroll();clearTransientView();let entry=staffPageCache.get(key);
  if(!entry){const el=document.createElement("section");el.className="staff-page-cache";el.dataset.cacheKey=key;const saved=readJSON(staffCacheScrollKey(key),{});entry={el,loaded:false,scroll:saved.scroll||0};staffPageCache.set(key,entry);appView.appendChild(el);}
  staffPageCache.forEach((x,k)=>x.el.hidden=k!==key);activeStaffPageKey=key;view=entry.el;
  if(!entry.loaded){entry.loaded=true;await initFn();}if(afterShow)await afterShow();requestAnimationFrame(()=>window.scrollTo({top:entry.scroll||0,behavior:"auto"}));
}
async function prefetchStaffData(force=false){
  if(!session||!profile||!["teacher","system_admin"].includes(profile.role))return staffDataCache;
  if(!force&&staffDataCache.users&&staffDataCache.classes&&staffDataCache.tests)return staffDataCache;
  if(staffPrefetchPromise&&!force)return staffPrefetchPromise;
  staffPrefetchPromise=Promise.all([
    sb.from("profiles").select("*").order("created_at",{ascending:false}),
    sb.from("classes").select("*").order("created_at",{ascending:false}),
    sb.from("tests").select("*").is("archived_at",null).order("created_at",{ascending:false})
  ]).then(([u,c,t])=>{if(!u.error)staffDataCache.users=u.data||[];if(!c.error)staffDataCache.classes=c.data||[];if(!t.error)staffDataCache.tests=t.data||[];staffDataCache.updatedAt=Date.now();return staffDataCache;}).finally(()=>{staffPrefetchPromise=null;});
  return staffPrefetchPromise;
}

async function loadProfile(){
  if(!session)return;const {data,error}=await sb.from("profiles").select("*").eq("id",session.user.id).single();
  if(error){console.error(error);profile=null;return;}profile=data;
}
function staffHeaderActive(){const p=route();if(p==="/teacher")return "home";if(p==="/accounts")return "accounts";if(p==="/classes"||p.startsWith("/class/"))return "classes";if(p==="/question-bank")return "bank";if(p==="/tests"||p.startsWith("/test/")||p.startsWith("/preview/")||p.startsWith("/practice-result/")||p.startsWith("/result/"))return "tests";return "";}
function renderHeader(){
  if(!session){if(staffHeaderNav){staffHeaderNav.hidden=true;staffHeaderNav.innerHTML="";}sessionActions.innerHTML='<a class="btn ghost header-btn" href="#/login">Đăng nhập</a>';return;}
  const isStaff=["teacher","system_admin"].includes(profile?.role);
  if(staffHeaderNav){staffHeaderNav.hidden=!isStaff;if(isStaff){const active=staffHeaderActive();staffHeaderNav.innerHTML=`<a class="header-nav-link ${active==="home"?"active":""}" href="#/teacher">Tổng quan</a><a class="header-nav-link ${active==="accounts"?"active":""}" href="#/accounts">Tài khoản</a><a class="header-nav-link ${active==="classes"?"active":""}" href="#/classes">Lớp</a><a class="header-nav-link ${active==="tests"?"active":""}" href="#/tests">Bài kiểm tra</a><a class="header-nav-link ${active==="bank"?"active":""}" href="#/question-bank">Ngân hàng</a>`;}}
  sessionActions.innerHTML=`<a class="user-name small profile-link" href="#/profile" title="Hồ sơ">${esc(profile?.full_name||session.user.email)} · ${esc(roleLabel(profile?.role||""))}</a><button class="ghost sm header-btn" id="logoutBtn">Đăng xuất</button>`;
  document.querySelector("#logoutBtn")?.addEventListener("click",async()=>{const activeExam=examCoordinator.getExamState();if(activeExam&&!activeExam.preview){saveAttemptUi();flushAnswerQueue();antiCheat.recordRouteLeave();return;}clearLiveChannel();clearStaffPages();testWorkspaceController.resetWorkspace();await sb.auth.signOut();go("/");});
}

let testWorkspaceController;
let authoringController;
let accountsController;
let classesController;
let questionBank;
let bankGenerator;

const examApp=createExamApp({sb,modalRoot,signedUrlMap,toast,closeModal,showLoading,staffNav,getSession:()=>session,getProfile:()=>profile,getView:()=>view});
const {renderStudent,renderStaffPracticeResult,renderResult}=examApp;
const examCoordinator=createExamCoordinator({sb,modalRoot,signedUrlMap,toast,closeModal,showLoading,staffNav,getSession:()=>session,getProfile:()=>profile,getView:()=>view,readingApp:examApp});
const saveAttemptUi=()=>examCoordinator.saveAttemptUi();
const flushAnswerQueue=()=>examCoordinator.flushAnswerQueue();
const setSaveStatus=(text,kind)=>examCoordinator.setSaveStatus(text,kind);
const antiCheat=createAntiCheatController({
  getExamState:()=>examCoordinator.getExamState(),getRoute:route,
  registerViolation:({attemptId,eventType,details,clientEventId})=>sb.rpc("register_violation_v2",{p_attempt_id:attemptId,p_event_type:eventType,p_details:details,p_client_event_id:clientEventId}),
  enforceAbsenceTimeout:({attemptId,leaveEventId})=>sb.rpc("enforce_absence_timeout_v1",{p_attempt_id:attemptId,p_leave_event_id:leaveEventId}),
  onCountChange:count=>{examCoordinator.setViolationCount(count);const el=document.querySelector("#antiCheatStatus"),mode=examCoordinator.getExamState()?.payload?.attempt?.anti_cheat_mode,limit=mode==="strict"?1:3;if(el)el.textContent=`Vi phạm: ${count}/${limit} · rời màn hình tính ngay${limit===1?" · chế độ nghiêm ngặt":" · quá 15 giây hoặc lần 3 sẽ tự nộp"}`;},
  onWarning:data=>toast(`Đã ghi nhận vi phạm ${data.violation_count}/3. Quá 15 giây hoặc vi phạm lần thứ 3 sẽ tự động nộp bài.`,6000),
  onSubmitted:data=>{const state=examCoordinator.getExamState(),id=state?.attemptId,strict=state?.payload?.attempt?.anti_cheat_mode==="strict";alert(data?.reason==="away_over_15_seconds"?"Bài đã tự động nộp vì bạn rời màn hình quá 15 giây.":strict?"Bài đã tự động nộp vì chế độ chống gian lận nghiêm ngặt ghi nhận một lần rời màn hình.":"Bài đã tự động nộp vì đã đủ 3 lần rời màn hình.");if(id){examCoordinator.resetExamState();antiCheat.reset();go(`/result/${id}`);}}
});
examCoordinator.setAntiCheat(antiCheat);

const staffResults=createStaffResultsController({sb,esc,fmt,statusBadge,toast,getWorkspace:()=>testState.workspace,setLiveChannel:channel=>{liveChannel=channel;},clearLiveChannel,refreshCurrentTest:(id,tab)=>testWorkspaceController.refreshCurrentTest(id,tab)});
authoringController=createAuthoringController({sb,modalRoot,uploadMedia,signedUrl,signedUrlMap,toast,closeModal,getSession:()=>session,getWorkspaceController:()=>testWorkspaceController,getBankGenerator:()=>bankGenerator});
testWorkspaceController=createTestWorkspaceController({sb,modalRoot,toast,closeModal,showLoading,staffNav,clearLiveChannel,invalidateStaffData,invalidateStaffPage,showStaffPage,getView:()=>view,getSession:()=>session,getStaffResults:()=>staffResults,getAuthoringController:()=>authoringController,testState,uploadMedia,signedUrl,removeMedia});
bankGenerator=createQuestionBankGeneratorController({sb,modalRoot,toast,closeModal,bankMedia,uploadMedia,removeMedia,onCommitted:async data=>{const id=data?.test_id;if(!id)return;testWorkspaceController.invalidateTestWorkspace(id);await testWorkspaceController.renderTestDetail(id,"authoring");}});
accountsController=createAccountsController({sb,modalRoot,toast,closeModal,showLoading,staffNav,prefetchStaffData,getStaffDataCache,invalidateStaffData,invalidateStaffPage,showStaffPage,getView:()=>view,getClassController:()=>classesController});
classesController=createClassesController({sb,modalRoot,toast,closeModal,showLoading,staffNav,prefetchStaffData,getStaffDataCache,invalidateStaffData,invalidateStaffPage,showStaffPage,getView:()=>view,getSession:()=>session,getAccountsController:()=>accountsController});
const dashboard=createDashboardController({showLoading,staffNav,prefetchStaffData,getStaffDataCache,getView:()=>view,getProfile:()=>profile});
const testCreate=createTestCreateController({sb,modalRoot,toast,closeModal,invalidateStaffData,invalidateStaffPage});
const testList=createTestListController({sb,showLoading,staffNav,prefetchStaffData,getStaffDataCache,getView:()=>view,getTestCreate:()=>testCreate});
const bankEditor=createQuestionBankEditorController({sb,modalRoot,toast,closeModal,bankMedia,onSaved:()=>questionBank?.refresh()});
questionBank=createQuestionBankListController({sb,toast,getSession:()=>session,getView:()=>view,getEditor:()=>bankEditor});
const authPages=createAuthPages({sb,toast,showLoading,invalidateStaffData,invalidateStaffPage,renderHeader,getSession:()=>session,getProfile:()=>profile,setProfile:v=>{profile=v;},loadProfile,getView:()=>view,getRecoveryMode:()=>passwordRecoveryMode,setRecoveryMode:v=>{passwordRecoveryMode=v;},rerender:render});

function requireStaff(fn){if(!session)return go("/login");if(!profile)return showLoading("Đang tải hồ sơ...");if(!["teacher","system_admin"].includes(profile.role))return go("/student");return fn();}
function requireStudent(fn){if(!session)return go("/login");if(!profile)return showLoading("Đang tải hồ sơ...");if(profile.role!=="student")return go("/teacher");if(profile.is_active===false){view.innerHTML='<section class="card"><h2>Tài khoản đang bị khóa</h2><p class="muted">Liên hệ giảng viên để được mở khóa. Tài khoản bị khóa không thể bắt đầu lượt thi mới.</p></section>';return;}return fn();}

function handleRouteChange(){
  const next=route(),state=examCoordinator.getExamState(),examPath=state&&!state.preview?`/exam/${state.attemptId}`:null;
  if(examPath&&lastRoute===examPath&&next!==examPath){history.replaceState(history.state,"",`${location.pathname}${location.search}#${examPath}`);lastRoute=examPath;saveAttemptUi();flushAnswerQueue();antiCheat.recordRouteLeave();return;}
  lastRoute=next;render();
}

async function render(){
  examCoordinator.stopTimer();const p=route();lastRoute=p;
  if(!p.startsWith("/preview/")&&examCoordinator.getExamState()?.preview){examCoordinator.resetExamState();closeModal();}
  const targetTestId=p.startsWith("/test/")?p.split("/")[2]:null;
  if(targetTestId&&testState.workspace&&testState.workspace.id!==targetTestId){clearLiveChannel();testWorkspaceController.resetWorkspace();}
  renderHeader();
  if(passwordRecoveryMode&&session&&p!=="/reset-password"){history.replaceState(null,"",`${location.pathname}#/reset-password`);clearStaffPages();return authPages.renderResetPassword();}
  if(session&&profile?.role==="student"&&profile?.must_change_password&&p!=="/profile"&&p!=="/reset-password")return go("/profile");
  if(p.startsWith("/exam/")){clearStaffPages();return examCoordinator.renderExam(p.split("/")[2]);}
  if(p.startsWith("/preview/")){clearStaffPages();return requireStaff(()=>examCoordinator.renderStaffPreview(p.split("/")[2]));}
  if(p.startsWith("/practice-result/")){const bits=p.split("/");clearStaffPages();return requireStaff(()=>renderStaffPracticeResult(bits[2],bits[3]));}
  if(p.startsWith("/result/")){const id=p.split("/")[2];if(profile&&["teacher","system_admin"].includes(profile.role))return requireStaff(()=>showStaffPage(`result:${id}`,()=>renderResult(id,true)));clearStaffPages();return renderResult(id,false);}
  if(p==="/forgot-password"){clearStaffPages();return authPages.renderForgotPassword();}
  if(p==="/reset-password"){clearStaffPages();return authPages.renderResetPassword();}
  if(p==="/login"){clearStaffPages();return authPages.renderLogin();}
  if(p==="/student"){clearStaffPages();return requireStudent(renderStudent);}
  if(p==="/profile")return session?showStaffPage("profile",authPages.renderProfile):go("/login");
  if(p==="/teacher")return requireStaff(()=>showStaffPage("teacher",dashboard.renderTeacher));
  if(p==="/accounts")return requireStaff(()=>showStaffPage("accounts",accountsController.renderAccounts));
  if(p==="/classes")return requireStaff(()=>showStaffPage("classes",classesController.renderClasses));
  if(p.startsWith("/class/")){const id=p.split("/")[2];return requireStaff(()=>showStaffPage(`class:${id}`,()=>classesController.renderClassDetail(id)));}
  if(p==="/tests")return requireStaff(()=>showStaffPage("tests",testList.renderTests));
  if(p==="/question-bank")return requireStaff(()=>showStaffPage("question-bank",questionBank.renderBank));
  if(p.startsWith("/test/")){const bits=p.split("/"),id=bits[2],tab=bits[3]||"overview";return requireStaff(()=>showStaffPage(`test:${id}`,()=>testWorkspaceController.renderTestDetail(id,tab),async()=>{if(testState.workspace?.id===id&&document.querySelector(`#testWorkspace[data-test-id="${id}"]`))await testWorkspaceController.activateTestTab(id,tab,{push:false,restore:true});else await testWorkspaceController.renderTestDetail(id,tab);}));}
  clearStaffPages();return authPages.renderHome();
}

async function boot(){
  const {data}=await sb.auth.getSession();session=data.session;if(session)await loadProfile();if(passwordRecoveryMode&&session)history.replaceState(null,"",`${location.pathname}#/reset-password`);
  sb.auth.onAuthStateChange((event,s)=>{session=s;profile=null;if(event==="PASSWORD_RECOVERY")passwordRecoveryMode=true;setTimeout(async()=>{if(s)await loadProfile();if(passwordRecoveryMode&&s)history.replaceState(null,"",`${location.pathname}#/reset-password`);render();},0);});
  addEventListener("hashchange",handleRouteChange);
  window.addEventListener("online",()=>{setSaveStatus("Có mạng – đang đồng bộ…","pending");flushAnswerQueue();});window.addEventListener("offline",()=>setSaveStatus("Mất mạng – đáp án sẽ lưu tạm","offline"));
  document.addEventListener("fullscreenchange",()=>{if(!examCoordinator.getExamState()||examCoordinator.getExamState().preview)return;saveAttemptUi();flushAnswerQueue();});
  document.addEventListener("visibilitychange",()=>{if(!examCoordinator.getExamState()||examCoordinator.getExamState().preview)return;saveAttemptUi();if(document.visibilityState==="visible")flushAnswerQueue();});
  window.addEventListener("pagehide",()=>{if(!examCoordinator.getExamState()||examCoordinator.getExamState().preview)return;saveAttemptUi();});
  render();
}

boot();
