import { Alert, Pressable, StyleSheet, Text, View } from 'react-native';
import { router, useLocalSearchParams } from 'expo-router';
import { BarChart3, BookOpen, Check, CheckCircle2, ClipboardCheck, ExternalLink, FileText, GraduationCap, Users, Video } from 'lucide-react-native';
import { useMemo, useState } from 'react';
import RoleTopBar from '../components/RoleTopBar';
import { ActionButton, ChoiceRow, EmptyState, ErrorState, Header, Input, LoadingState, Notice, Panel, pct, ProfileBlock, ProgressLine, Row, Screen, SearchInput, SectionTitle, StatCard } from '../components/FunctionalUI';
import { ProfilePhotoUploader } from '../components/AppwriteUploaders';
import { useAuth } from '../context/AuthContext';
import { useTheme } from '../context/ThemeContext';
import { useLoad } from '../hooks/useLoad';
import { formatWhen, getLessons, getModules, getProgress, getStudentDashboardProgress, getQuestions, getStudentAssignment, lessonQuizIsPublished, lower, normalizeSection, normalizeYearLevel, progressSummary, saveProfile, saveQuizProgress, studentCourse, studentSection, YEAR_LEVELS } from '../lib/data';
import { hasExternalUrl, openExternalUrl } from '../lib/links';

function requireStudentSectionId(profile) {
  const sectionId = String(profile?.sectionId || '').trim();
  if (!sectionId) {
    throw new Error('Your account has no assigned section yet. Please contact your school administrator.');
  }
  return sectionId;
}

const DASHBOARD_QUERY_TIMEOUT_MS = 9000;

function dashboardQuery(label, task, fallback) {
  let timeoutId;
  const request = Promise.resolve().then(task);
  const timeout = new Promise((_, reject) => {
    timeoutId = setTimeout(() => reject(new Error(`${label} request timed out. Check your connection and retry.`)), DASHBOARD_QUERY_TIMEOUT_MS);
  });
  return Promise.race([request, timeout])
    .then(value => ({ value, warning: '' }))
    .catch(error => {
      console.warn(`[EqualLearn Student Dashboard] ${label} unavailable:`, error?.code || error?.message || error);
      return { value: fallback, warning: `${label}: ${error?.message || 'temporarily unavailable'}` };
    })
    .finally(() => clearTimeout(timeoutId));
}

async function studentBundle(uid, profile) {
  const sectionId = requireStudentSectionId(profile);

  // Fetch lessons once and share the same in-flight request with getModules().
  // The other independent dashboard reads run concurrently with those queries.
  const lessonsRequest = getLessons(sectionId);
  const [lessons, modules, progress, assignment] = await Promise.all([
    dashboardQuery('Lessons', () => lessonsRequest, []),
    dashboardQuery('Modules', () => getModules(sectionId, lessonsRequest.catch(() => [])), []),
    dashboardQuery('Progress', () => getStudentDashboardProgress(uid, 50), []),
    dashboardQuery('Teacher assignment', () => getStudentAssignment(profile), null)
  ]);

  return {
    modules: modules.value || [],
    lessons: lessons.value || [],
    progress: progress.value || [],
    assignment: assignment.value || null,
    warnings: [lessons.warning, modules.warning, progress.warning, assignment.warning].filter(Boolean)
  };
}

export function StudentHome() {
  const { firebaseUser, profile } = useAuth();
  const load = useLoad(() => studentBundle(firebaseUser.uid, profile), [firebaseUser.uid, profile?.sectionId, profile?.course, profile?.yearLevel, profile?.section, profile?.cohort]);

  if (load.loading && !load.data) {
    const first = (profile?.fullname || 'Student').trim().split(/\s+/)[0];
    return <Screen>
      <RoleTopBar profilePath="/student/profile"/>
      <Header eyebrow="Student home" title={`Hello, ${first}.`} text="Your learning overview is loading."/>
      <Panel><MutedText>Loading your modules and progress. You can stay on this screen while the data connects.</MutedText></Panel>
    </Screen>;
  }
  if (load.error) return <ErrorState message={load.error} onRetry={load.refresh}/>;

  const { modules = [], lessons = [], progress = [], assignment = null, warnings = [] } = load.data || {};
  const quizLessonIds = new Set(lessons.filter(lessonQuizIsPublished).map(lesson => lesson.id).filter(Boolean));
  const relevantProgress = quizLessonIds.size
    ? progress.filter(row => quizLessonIds.has(row.lessonId))
    : progress;
  const completedIds = new Set(relevantProgress.filter(row => row.completed).map(row => row.lessonId).filter(Boolean));
  const summary = {
    completed: completedIds.size,
    total: quizLessonIds.size,
    percent: quizLessonIds.size ? Math.round(completedIds.size / quizLessonIds.size * 100) : 0,
    average: relevantProgress.length ? Math.round(relevantProgress.reduce((sum, row) => sum + Number(row.percentage || 0), 0) / relevantProgress.length) : 0,
    attempts: relevantProgress.length
  };

  const done = new Set(progress.filter(x => x.completed).map(x => x.lessonId));
  const lessonsByModule = new Map();
  for (const lesson of lessons) {
    const key = String(lesson.moduleId || '').trim();
    if (!key) continue;
    if (!lessonsByModule.has(key)) lessonsByModule.set(key, []);
    lessonsByModule.get(key).push(lesson);
  }
  const rows = modules
    .filter(m => !['inactive', 'draft'].includes(lower(m.status || 'active')))
    .map(m => {
      const moduleLessons = lessonsByModule.get(m.id) || [];
      const completed = moduleLessons.filter(x => done.has(x.id)).length;
      return { ...m, lessons: moduleLessons, completed, percent: moduleLessons.length ? Math.round(completed / moduleLessons.length * 100) : 0 };
    });
  const next = rows.find(x => x.percent < 100) || rows[0];
  const first = (profile?.fullname || 'Student').trim().split(/\s+/)[0];

  return <Screen>
    <RoleTopBar profilePath="/student/profile"/>
    <Header eyebrow="Student home" title={`Hello, ${first}.`} text="Continue learning and review your EqualLearn progress."/>
    {warnings.length ? <Notice type="info">Some dashboard details are temporarily unavailable. Available learning data is still shown below.</Notice> : null}
    <StatCard label="Quiz completion" value={pct(summary.percent)} detail={`${summary.completed}/${summary.total} published quiz lessons`} Icon={ClipboardCheck}/>
    <StatCard label="Average score" value={pct(summary.average)} detail={`${summary.attempts} saved results`} Icon={BarChart3}/>
    <StatCard label="Section" value={studentSection(profile) || '—'} detail={assignment?.teacherName ? `Teacher: ${assignment.teacherName}` : 'Teacher information unavailable'} Icon={Users}/>
    <SectionTitle label="Continue learning" title={next?.title || 'No module yet'}/>
    <Panel>{next ? <><BodyText>{next.description || 'Continue your next lesson.'}</BodyText><View style={{marginTop:14}}><ProgressLine value={next.percent} label={`${next.completed}/${next.lessons.length} lessons`}/></View><ActionButton style={{marginTop:14}} onPress={() => router.push(`/student/module/${next.id}`)}>Continue module</ActionButton></> : <EmptyState title="No published modules" text="Your teacher's published materials will appear here."/>}</Panel>
    <SectionTitle label="Academic profile" title="Student details"/>
    <Panel><Fact label="Course" value={studentCourse(profile)}/><Fact label="Year Level" value={normalizeYearLevel(profile?.yearLevel) || '—'}/><Fact label="Section" value={studentSection(profile) || '—'}/><Fact label="Teacher" value={assignment?.teacherName || '—'}/></Panel>
    {warnings.length ? <ActionButton variant="secondary" style={{marginTop:12}} onPress={load.refresh}>Retry unavailable dashboard data</ActionButton> : null}
  </Screen>;
}

export function StudentLearning() {
  const { firebaseUser, profile } = useAuth();
  const [search, setSearch] = useState('');
  const [filter, setFilter] = useState('all');
  const load = useLoad(async () => { const sectionId = requireStudentSectionId(profile); const [modules, lessons, progress] = await Promise.all([getModules(sectionId), getLessons(sectionId), getProgress(firebaseUser.uid)]); return { modules, lessons, progress }; }, [firebaseUser.uid, profile?.sectionId]);
  if (load.loading) return <LoadingState/>;
  const done = new Set((load.data?.progress || []).filter(x => x.completed).map(x => x.lessonId));
  let rows = (load.data?.modules || []).filter(m => !['inactive','draft'].includes(lower(m.status || 'active'))).map(m => {
    const ls = load.data.lessons.filter(x => x.moduleId === m.id);
    const completed = ls.filter(x => done.has(x.id)).length;
    return { ...m, lessons: ls, completed, percent: ls.length ? Math.round(completed / ls.length * 100) : 0 };
  });
  if (search) rows = rows.filter(x => `${x.title} ${x.description}`.toLowerCase().includes(search.toLowerCase()));
  if (filter === 'progress') rows = rows.filter(x => x.percent > 0 && x.percent < 100);
  if (filter === 'completed') rows = rows.filter(x => x.lessons.length && x.percent === 100);
  return <Screen><Header eyebrow="Learning" title="Your learning path" text="Open modules, lessons, resources, and assessments."/><SearchInput value={search} onChangeText={setSearch} placeholder="Search modules…"/><ChoiceRow value={filter} onChange={setFilter} options={[{value:'all',label:'All'},{value:'progress',label:'In progress'},{value:'completed',label:'Completed'}]}/>
    {rows.map(m => <Pressable key={m.id} onPress={() => router.push(`/student/module/${m.id}`)}><Panel style={{marginBottom:9}}><TitleText>{m.title}</TitleText><MutedText>{m.description || 'No description.'}</MutedText><View style={{marginTop:12}}><ProgressLine value={m.percent} label={`${m.completed}/${m.lessons.length} lessons`}/></View></Panel></Pressable>)}
    {!rows.length ? <Panel><EmptyState title="No modules match this view"/></Panel> : null}
  </Screen>;
}

export function StudentModule() {
  const { moduleId } = useLocalSearchParams();
  const { firebaseUser, profile } = useAuth();
  const load = useLoad(async () => { const sectionId = requireStudentSectionId(profile); const [modules, lessons, questions, progress] = await Promise.all([getModules(sectionId), getLessons(sectionId), getQuestions(sectionId), getProgress(firebaseUser.uid)]); return { module: modules.find(x => x.id === moduleId), lessons: lessons.filter(x => x.moduleId === moduleId), questions, progress }; }, [moduleId, firebaseUser.uid, profile?.sectionId]);
  if (load.loading) return <LoadingState/>;
  if (!load.data?.module) return <ErrorState message="This module is unavailable."/>;
  const { module, lessons, questions, progress } = load.data;
  const progressMap = new Map(progress.map(x => [x.lessonId, x]));
  return <Screen><ActionButton variant="secondary" onPress={() => router.back()} style={{alignSelf:'flex-start',marginBottom:14}}>Back to Learning</ActionButton><Header eyebrow="Module" title={module.title} text={module.description}/>
    {hasExternalUrl(module.fileURL) ? <Panel style={{marginBottom:10}}><Row title={module.fileName || 'Module resource'} subtitle="External learning resource" left={<FileText size={20}/>} onPress={() => openExternalUrl(module.fileURL, 'Module resource')}/></Panel> : null}
    <SectionTitle title="Lessons"/>
    <Panel>{lessons.map((lesson, index) => { const count = lessonQuizIsPublished(lesson) ? questions.filter(q => q.lessonId === lesson.id).length : 0; const saved = progressMap.get(lesson.id); return <View key={lesson.id}><Row title={`${index + 1}. ${lesson.title}`} subtitle={lesson.description || 'No description.'} meta={`${count} questions${saved ? ` · Last ${pct(saved.percentage)}` : ''}`} right={<View style={s.lessonActions}>{hasExternalUrl(lesson.fileUrl) ? <Pressable onPress={() => openExternalUrl(lesson.fileUrl, 'Lesson resource')}><FileText size={18}/></Pressable> : null}{hasExternalUrl(lesson.videoUrl) ? <Pressable onPress={() => openExternalUrl(lesson.videoUrl, 'Lesson video')}><Video size={18}/></Pressable> : null}{count ? <Pressable onPress={() => router.push(`/student/quiz/${lesson.id}`)}><ClipboardCheck size={19}/></Pressable> : null}</View>}/></View>; })}{!lessons.length ? <EmptyState title="No lessons yet"/> : null}</Panel>
  </Screen>;
}

export function StudentQuizzes() {
  const { firebaseUser, profile } = useAuth();
  const [search, setSearch] = useState('');
  const [filter, setFilter] = useState('all');
  const load = useLoad(async () => { const sectionId = requireStudentSectionId(profile); const [lessons, questions, progress] = await Promise.all([getLessons(sectionId), getQuestions(sectionId), getProgress(firebaseUser.uid)]); return { lessons, questions, progress }; }, [firebaseUser.uid, profile?.sectionId]);
  if (load.loading) return <LoadingState/>;
  const pm = new Map((load.data?.progress || []).map(x => [x.lessonId, x]));
  let rows = (load.data?.lessons || []).filter(lessonQuizIsPublished).map(x => ({ ...x, count: load.data.questions.filter(q => q.lessonId === x.id).length, progress: pm.get(x.id) })).filter(x => x.count);
  if (search) rows = rows.filter(x => `${x.title} ${x.moduleName || ''}`.toLowerCase().includes(search.toLowerCase()));
  if (filter === 'available') rows = rows.filter(x => !x.progress);
  if (filter === 'completed') rows = rows.filter(x => x.progress);
  return <Screen><Header eyebrow="Quizzes" title="Check what you know" text="Take real lesson assessments and save your latest result."/><SearchInput value={search} onChangeText={setSearch} placeholder="Search quizzes…"/><ChoiceRow value={filter} onChange={setFilter} options={['all','available','completed'].map(x => ({value:x,label:x[0].toUpperCase()+x.slice(1)}))}/>
    {rows.map(x => <Panel key={x.id} style={{marginBottom:9}}><TitleText>{x.title}</TitleText><MutedText>{x.moduleName || 'Lesson quiz'} · {x.count} questions</MutedText><MutedText>{x.progress ? `Last score ${pct(x.progress.percentage)} · ${x.progress.result}` : 'No attempt yet'}</MutedText><ActionButton style={{marginTop:12}} onPress={() => router.push(`/student/quiz/${x.id}`)}>{x.progress ? 'Retake quiz' : 'Start quiz'}</ActionButton></Panel>)}
    {!rows.length ? <Panel><EmptyState title="No quizzes found"/></Panel> : null}
  </Screen>;
}

export function StudentQuiz() {
  const { theme } = useTheme();
  const { lessonId } = useLocalSearchParams();
  const { firebaseUser, profile } = useAuth();
  const [index, setIndex] = useState(0);
  const [selected, setSelected] = useState('');
  const [answers, setAnswers] = useState([]);
  const [result, setResult] = useState(null);
  const [message, setMessage] = useState('');
  const load = useLoad(async () => { const sectionId = requireStudentSectionId(profile); const [lessons, questions] = await Promise.all([getLessons(sectionId), getQuestions(sectionId)]); const lesson = lessons.find(x => x.id === lessonId); return { lesson, questions: lesson && lessonQuizIsPublished(lesson) ? questions.filter(x => x.lessonId === lessonId) : [] }; }, [lessonId, profile?.sectionId]);
  if (load.loading) return <LoadingState/>;
  const questions = load.data?.questions || [];
  if (!questions.length) return <ErrorState message="No questions are available for this lesson."/>;
  async function next() {
    if (!selected) { setMessage('Choose an answer first.'); return; }
    const all = [...answers, { selected, correct: selected === questions[index].correctAnswer }];
    if (index < questions.length - 1) { setAnswers(all); setIndex(v => v + 1); setSelected(''); setMessage(''); return; }
    const saved = await saveQuizProgress({ uid: firebaseUser.uid, lessonId, score: all.filter(x => x.correct).length, total: questions.length });
    setResult(saved);
  }
  if (result) return <Screen><Header eyebrow="Quiz complete" title={result.result === 'passing' ? 'You passed.' : 'Keep reviewing.'} text={`${result.score}/${result.total} correct · ${pct(result.percentage)}`}/><Panel><Text style={[s.result, {color: result.result === 'passing' ? '#397b5c' : '#a34f64'}]}>{pct(result.percentage)}</Text><TitleText>{load.data.lesson?.title || 'Quiz'}</TitleText><MutedText>Your result has been saved to Firestore.</MutedText><View style={s.twoButtons}><ActionButton variant="secondary" style={{flex:1}} onPress={() => { setIndex(0); setSelected(''); setAnswers([]); setResult(null); }}>Retake</ActionButton><ActionButton style={{flex:1}} onPress={() => router.replace('/student/progress')}>View progress</ActionButton></View></Panel></Screen>;
  const q = questions[index];
  const choices = [['A',q.choiceA],['B',q.choiceB],['C',q.choiceC],['D',q.choiceD]];
  return <Screen><ActionButton variant="secondary" onPress={() => router.back()} style={{alignSelf:'flex-start',marginBottom:12}}>Exit quiz</ActionButton><Header eyebrow={`Question ${index + 1} of ${questions.length}`} title={load.data.lesson?.title || 'Quiz'} text="Choose one answer before continuing."/><Panel><ProgressLine value={(index / questions.length) * 100}/><Text style={[s.question, {marginTop:18,color:theme.text}]}>{q.question}</Text>{choices.map(([key, text]) => <Pressable key={key} onPress={() => { setSelected(key); setMessage(''); }} style={[s.quizChoice,{borderColor:theme.line}, selected === key && {backgroundColor:theme.primary,borderColor:theme.primary}]}><Text style={[s.choiceKey,{color:theme.text}, selected === key && {color:'#fff'}]}>{key}</Text><Text style={[s.choiceText,{color:theme.text}, selected === key && {color:'#fff'}]}>{text}</Text></Pressable>)}<Notice type="error">{message}</Notice><ActionButton onPress={next}>{index === questions.length - 1 ? 'Finish quiz' : 'Next question'}</ActionButton></Panel></Screen>;
}

export function StudentProgress() {
  const { firebaseUser, profile } = useAuth();
  const load = useLoad(async () => { const sectionId = requireStudentSectionId(profile); const [progress, lessons, questions] = await Promise.all([getProgress(firebaseUser.uid), getLessons(sectionId), getQuestions(sectionId)]); return { progress, lessons, questions }; }, [firebaseUser.uid, profile?.sectionId]);
  if (load.loading) return <LoadingState/>;
  const summary = progressSummary(load.data.progress, load.data.questions);
  const lessons = new Map(load.data.lessons.map(x => [x.id, x]));
  return <Screen><Header eyebrow="Progress" title="Your learning record" text="Real saved quiz results from Firestore."/><StatCard label="Quiz completion" value={pct(summary.percent)} detail={`${summary.completed}/${summary.total}`} Icon={CheckCircle2}/><StatCard label="Average score" value={pct(summary.average)} Icon={BarChart3}/><StatCard label="Passing results" value={summary.passed} Icon={GraduationCap}/><SectionTitle title="Assessment history"/><Panel>{load.data.progress.map(p => <Row key={p.id} title={lessons.get(p.lessonId)?.title || 'Lesson'} subtitle={`${p.score}/${p.total} · ${pct(p.percentage)} · ${p.result}`} meta={formatWhen(p.completedAt)} onPress={() => router.push(`/student/quiz/${p.lessonId}`)} left={p.result === 'passing' ? <Check color="#397b5c" size={18}/> : <ClipboardCheck size={18}/>}/>)}{!load.data.progress.length ? <EmptyState title="No progress recorded yet"/> : null}</Panel></Screen>;
}

export function StudentProfile() {
  const { firebaseUser, profile, refreshProfile, logout } = useAuth();
  const [form, setForm] = useState({ fullname: profile?.fullname || '', course: 'BSIT', yearLevel: normalizeYearLevel(profile?.yearLevel) || '', section: studentSection(profile) || '', phone: profile?.phone || '', bio: profile?.bio || '' });
  const [message, setMessage] = useState('');
  const preview = useMemo(() => ({ ...profile, ...form, course: 'BSIT' }), [profile, form]);
  const set = (key, value) => setForm(x => ({ ...x, [key]: value }));
  async function save() {
    if (!form.fullname.trim()) { setMessage('Enter your full name.'); return; }
    if (!YEAR_LEVELS.includes(form.yearLevel)) { setMessage('Choose 1st, 2nd, 3rd, or 4th year.'); return; }
    const section = normalizeSection(form.section);
    if (!section) { setMessage('Section must contain 1 to 3 letters or numbers.'); return; }
    await saveProfile(firebaseUser.uid, { fullname: form.fullname.trim(), course: 'BSIT', yearLevel: form.yearLevel, section, classGroupId: `SECTION_BSIT_${section}`, phone: form.phone.trim(), bio: form.bio.trim() });
    await refreshProfile();
    set('section', section);
    setMessage('Profile updated successfully.');
  }
  const leave = () => Alert.alert('Logout', 'Are you sure you want to logout?', [{text:'Cancel',style:'cancel'},{text:'Logout',style:'destructive',onPress:async()=>{await logout();router.replace('/login');}}]);
  return <Screen><Header eyebrow="Profile" title="Your student profile" text="Keep your contact and academic information current."/><ProfileBlock person={preview} role="student"/><ProfilePhotoUploader/><SectionTitle title="Edit profile"/><Panel><Input label="Full name" value={form.fullname} onChangeText={v=>set('fullname',v)}/><Input label="Email" value={profile?.email || ''} editable={false}/><Input label="Student number" value={profile?.studentNumber || ''} editable={false}/><Input label="Course" value="BSIT" editable={false}/><Label>Year Level</Label><ChoiceRow value={form.yearLevel} onChange={v=>set('yearLevel',v)} options={YEAR_LEVELS}/><Input label="Section (1–3 letters/numbers)" value={form.section} onChangeText={v=>set('section',normalizeSection(v))} maxLength={3} autoCapitalize="characters"/><Input label="Phone" value={form.phone} onChangeText={v=>set('phone',v)} keyboardType="phone-pad"/><Input label="Bio" value={form.bio} onChangeText={v=>set('bio',v)} multiline/><Notice type={message.includes('success') ? 'success' : 'error'}>{message}</Notice><ActionButton onPress={save}>Save profile</ActionButton></Panel><View style={{height:10}}/><ActionButton variant="secondary" onPress={()=>router.push('/settings')}>Settings</ActionButton><View style={{height:8}}/><ActionButton variant="secondary" onPress={()=>router.push('/about')}>About EqualLearn</ActionButton><View style={{height:8}}/><ActionButton variant="danger" onPress={leave}>Logout</ActionButton></Screen>;
}

function Fact({ label, value }) { const {theme}=useTheme(); return <View style={s.fact}><Text style={[s.factLabel,{color:theme.muted}]}>{label}</Text><Text style={[s.factValue,{color:theme.text}]}>{value}</Text></View>; }
function BodyText({children}){const{theme}=useTheme();return <Text style={[s.body,{color:theme.text}]}>{children}</Text>}
function TitleText({children}){const{theme}=useTheme();return <Text style={[s.cardTitle,{color:theme.text}]}>{children}</Text>}
function MutedText({children}){const{theme}=useTheme();return <Text style={[s.muted,{color:theme.muted}]}>{children}</Text>}
function Label({children}){const{theme}=useTheme();return <Text style={[s.fieldLabel,{color:theme.text}]}>{children}</Text>}

const s = StyleSheet.create({body:{fontSize:11,lineHeight:18},cardTitle:{fontSize:15,fontWeight:'900'},muted:{fontSize:10,lineHeight:16,opacity:.72,marginTop:4},fact:{flexDirection:'row',justifyContent:'space-between',paddingVertical:10,borderBottomWidth:StyleSheet.hairlineWidth,borderBottomColor:'rgba(120,120,120,.22)'},factLabel:{fontSize:10,opacity:.65},factValue:{fontSize:11,fontWeight:'900'},lessonActions:{flexDirection:'row',gap:12,alignItems:'center'},twoButtons:{flexDirection:'row',gap:8,marginTop:16},result:{fontSize:46,fontWeight:'900',marginBottom:10},question:{fontSize:17,fontWeight:'900',lineHeight:24,marginBottom:14},quizChoice:{flexDirection:'row',gap:11,alignItems:'center',borderWidth:1,borderColor:'rgba(120,120,120,.28)',padding:13,borderRadius:14,marginBottom:8},quizChoiceActive:{backgroundColor:'#397b5c',borderColor:'#397b5c'},choiceKey:{width:24,fontSize:11,fontWeight:'900'},choiceText:{flex:1,fontSize:11,fontWeight:'700'},fieldLabel:{fontSize:10,fontWeight:'800',marginBottom:6}});
