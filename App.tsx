import Login from "./Login.tsx";
import ForgotPassword from "./ForgotPassword.tsx";
import { signOut } from "firebase/auth";
import React, { useEffect, useMemo, useState, useRef } from 'react';
import { AnimatePresence, motion, Reorder } from 'framer-motion';
import { Sidebar } from './components/layout/Sidebar';
import { TaskItem } from './components/task/TaskItem';
import { TaskInput } from './components/task/TaskInput';
import { FocusMode } from './components/features/focus/FocusMode';
import { Insights } from './components/features/insights/Insights';
import { CalendarView } from './components/features/calendar/CalendarView';
import { HelpView } from './components/features/help/HelpView';
import { Badge } from './components/ui/Badge';
import { ConfirmDialog } from './components/ui/ConfirmDialog';
import { InputDialog } from './components/ui/InputDialog';
import { AlertDialog } from './components/ui/AlertDialog';
import { useStore, setupSettingsListener, setupDailyTargetsListener, setupTaskHistoryListener } from './store';
import { View, Priority, Task, Recurrence } from './types';
import { isToday, isFuture, format, isValid } from 'date-fns';
import { listenToUserTasks } from "./repos/firestoreTasks";
import { listenToUserTags } from "./repos/firestoreTags";
import { updateUserLastLogin } from "./repos/firestoreUsers";
import { isOverdue } from './backend/utils/dateUtils.ts';
import {
  Search, Bell, Moon, Sun, CheckCircle2, Menu, ListChecks,
  Trash2, CheckCircle, X, Download, Upload, Zap, Save, Sparkles,
  ArrowRight, Loader2, Plus, Minus, Filter, Edit2, Palette, ChevronRight,
  Calendar, Flag, Check, LayoutList, Repeat, CircleHelp
} from 'lucide-react';
import Register from "./Register";
import { onAuthStateChanged, User } from "firebase/auth";
import { auth } from "./firebase";
import { Routes, Route, Navigate } from 'react-router-dom';

// Sound utility with lazy singleton AudioContext (created only on user gesture)
let audioCtx: AudioContext | null = null;

const initAudioContext = () => {
  if (!audioCtx) {
    try {
      const AudioContext = window.AudioContext || (window as any).webkitAudioContext;
      if (AudioContext) {
        audioCtx = new AudioContext();
        console.log('✅ AudioContext initialized');
      }
    } catch (e) {
      console.warn("❌ AudioContext initialization failed", e);
    }
  }
  
  // Immediately try to resume if it was suspended (e.g., after initial creation)
  if (audioCtx && audioCtx.state === 'suspended') {
    audioCtx.resume()
      .then(() => {
        console.log('✅ AudioContext resumed successfully after user gesture.');
      })
      .catch(error => {
        console.error('❌ Failed to resume AudioContext:', error);
      });
  }
};

const playSound = (freq = 440, type: OscillatorType = 'sine', duration = 0.2, vol = 0.1) => {
  try {
    // Initialize on first sound play
    initAudioContext();
    
    if (!audioCtx) {
      console.warn("⚠️ AudioContext not available. Sound disabled.");
      return;
    }

    const osc = audioCtx.createOscillator();
    const gain = audioCtx.createGain();

    osc.type = type;
    osc.frequency.setValueAtTime(freq, audioCtx.currentTime);
    osc.connect(gain);
    gain.connect(audioCtx.destination);

    osc.start();
    gain.gain.setValueAtTime(vol, audioCtx.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.001, audioCtx.currentTime + duration);
    osc.stop(audioCtx.currentTime + duration);
  } catch (e) {
    console.error("❌ Audio play failed", e);
  }
};

const App: React.FC = () => {

  // 🔐 AUTH STATE
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const unsubscribe = onAuthStateChanged(auth, (currentUser) => {
      setUser(currentUser);
      // Update last login when user authenticates
      if (currentUser) {
        updateUserLastLogin(currentUser.uid).catch(console.error);
      }
      setLoading(false);
    });
    return () => unsubscribe();
  }, []);

  // Initialize AudioContext on first user gesture
  useEffect(() => {
    const userGestureHandler = () => {
      initAudioContext();
      // Remove listeners once audio context is initialized
      document.removeEventListener('click', userGestureHandler);
      document.removeEventListener('keydown', userGestureHandler);
      document.removeEventListener('touchstart', userGestureHandler);
      console.log('✅ AudioContext initialized via user gesture');
    };

    document.addEventListener('click', userGestureHandler);
    document.addEventListener('keydown', userGestureHandler);
    document.addEventListener('touchstart', userGestureHandler);

    return () => {
      document.removeEventListener('click', userGestureHandler);
      document.removeEventListener('keydown', userGestureHandler);
      document.removeEventListener('touchstart', userGestureHandler);
    };
  }, []);

  // 🔥 FIRESTORE SYNC
  useEffect(() => {
    if (!user) return;

    const unsubscribe = listenToUserTasks(user.uid, (tasks) => {
      useStore.getState().setTasks(tasks);
    });

    return () => unsubscribe();
  }, [user]);

  // 🏷️ TAGS SYNC
  useEffect(() => {
    if (!user) return;

    const unsubscribeTags = listenToUserTags(user.uid, (tags) => {
      useStore.getState().setTags(tags);
    });

    return () => unsubscribeTags();
  }, [user]);

  // ⚙️ SETTINGS SYNC
  useEffect(() => {
    if (!user) return;

    const unsubscribeSettings = setupSettingsListener(user.uid);
    return () => unsubscribeSettings?.();
  }, [user]);

  // 🎯 DAILY TARGETS SYNC
  useEffect(() => {
    if (!user) return;

    const unsubscribeTargets = setupDailyTargetsListener(user.uid);
    return () => unsubscribeTargets?.();
  }, [user]);

  // 📝 TASK HISTORY SYNC
  useEffect(() => {
    if (!user) return;

    const unsubscribeHistory = setupTaskHistoryListener(user.uid);
    return () => unsubscribeHistory?.();
  }, [user]);


  // 🧠 your Zustand store
  const {
    activeView, tasks, tags, setView, theme, setTheme, accentColor, setAccentColor,
    updateStreak, streak, dailyGoal, setDailyGoal, bulkDelete, bulkToggle, importData,
    updateTask, reorderTasks, toggleSubtask, generateAIActionPlan, deleteTask,
    searchQuery, setSearchQuery, filterTagId, setFilterTagId, updateTag, deleteTag,
    addTag, focusState, tickFocusTimer, setFocusState
  } = useStore();

  const [sidebarOpen, setSidebarOpen] = useState(window.innerWidth >= 1024);
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [selectionMode, setSelectionMode] = useState(false);
  const [editingTask, setEditingTask] = useState<Task | null>(null);
  const [showGoalCelebration, setShowGoalCelebration] = useState(false);
  const [viewMode, setViewMode] = useState<'list' | 'calendar'>('list');
  const [selectedDate, setSelectedDate] = useState<Date>(new Date());

  // Dialog States
  const [confirmDialog, setConfirmDialog] = useState<{
    isOpen: boolean;
    title: string;
    message: string;
    onConfirm: () => void;
    isDanger?: boolean;
    confirmLabel?: string;
  }>({ isOpen: false, title: '', message: '', onConfirm: () => { } });

  const [inputDialog, setInputDialog] = useState<{
    isOpen: boolean;
    title: string;
    placeholder?: string;
    onSubmit: (value: string) => void;
  }>({ isOpen: false, title: '', onSubmit: () => { } });

  const [alertDialog, setAlertDialog] = useState<{
    isOpen: boolean;
    title: string;
    message: string;
  }>({ isOpen: false, title: '', message: '' });

  // Tag Color Selection State
  const [tagColorDialog, setTagColorDialog] = useState<{
    isOpen: boolean;
    tagName: string;
  }>({ isOpen: false, tagName: '' });
  const [selectedTagColor, setSelectedTagColor] = useState('#6366f1');

  // Predefined color palette for tags
  const TAG_COLORS = [
    '#6366f1', // Indigo
    '#10b981', // Emerald
    '#f59e0b', // Amber
    '#ef4444', // Red
    '#8b5cf6', // Violet
    '#ec4899', // Pink
  ];

  // Subtask Editing State
  const [editingSubtaskId, setEditingSubtaskId] = useState<string | null>(null);
  const [tempSubtaskTitle, setTempSubtaskTitle] = useState('');
  const editInputRef = useRef<HTMLInputElement>(null);

  const fileInputRef = useRef<HTMLInputElement>(null);
  const prevCompletedCountRef = useRef(tasks.filter(t => t.completed).length);

  // Global Timer Tick Effect
  useEffect(() => {
    if (!focusState.isActive) return;
    const interval = setInterval(tickFocusTimer, 1000);
    return () => clearInterval(interval);
  }, [focusState.isActive, tickFocusTimer]);

  // Global Timer Completion Check Effect
  useEffect(() => {
    if (focusState.isActive && focusState.timeLeft === 0) {
      setFocusState({ isActive: false });
      playSound(880, 'square', 0.5, 0.2);
      setTimeout(() => playSound(587, 'sine', 0.8, 0.2), 600);

      if (focusState.mode === 'work') {
        setFocusState({ mode: 'break', timeLeft: 5 * 60 });
      } else {
        setFocusState({ mode: 'work', timeLeft: 25 * 60 });
      }
    }
  }, [focusState.isActive, focusState.timeLeft, focusState.mode, setFocusState]);

  // Task Completion Sound Logic
  useEffect(() => {
    const currentCompleted = tasks.filter(t => t.completed).length;
    if (currentCompleted > prevCompletedCountRef.current) {
      playSound(1200, 'sine', 0.1, 0.05); // Subtle success ping
      setTimeout(() => playSound(1800, 'sine', 0.15, 0.05), 100);
    }
    prevCompletedCountRef.current = currentCompleted;
  }, [tasks]);

  // Responsive Sidebar Logic
  useEffect(() => {
    const handleResize = () => {
      // Only auto-close on mobile, don't force open on desktop to respect user toggle
      if (window.innerWidth < 1024 && sidebarOpen) {
        setSidebarOpen(false);
      }
      if (window.innerWidth >= 1024 && !sidebarOpen) {
        // Optional: decide if we want to auto-open on resize to desktop. 
        // For now, let's allow it to be consistent with initial state, 
        // but checking if it was user-initiated might be better. 
        // Keeping it simple: if you resize to desktop, sidebar opens.
        setSidebarOpen(true);
      }
    };
    window.addEventListener('resize', handleResize);
    return () => window.removeEventListener('resize', handleResize);
  }, [sidebarOpen]);

  // Focus input when entering edit mode
  useEffect(() => {
    if (editingSubtaskId && editInputRef.current) {
      editInputRef.current.focus();
    }
  }, [editingSubtaskId]);

  const handleMobileNav = () => {
    if (window.innerWidth < 1024) {
      setSidebarOpen(false);
    }
  };

  const handleExport = () => {
    const data = {
      tasks: useStore.getState().tasks,
      tags: useStore.getState().tags,
      theme: useStore.getState().theme,
      accentColor: useStore.getState().accentColor,
      streak: useStore.getState().streak,
      dailyGoal: useStore.getState().dailyGoal,
      lastCompletedDate: useStore.getState().lastCompletedDate,
    };
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `todos-backup-${format(new Date(), 'yyyy-MM-dd')}.json`;
    link.click();
    URL.revokeObjectURL(url);
  };

  const handleImport = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (event) => {
      try {
        const data = JSON.parse(event.target?.result as string);
        importData(data);
        setAlertDialog({
          isOpen: true,
          title: 'Import Successful',
          message: 'Your data has been successfully imported!'
        });
      } catch (err) {
        setAlertDialog({
          isOpen: true,
          title: 'Import Failed',
          message: 'Failed to import data. Please check the file format.'
        });
      }
    };
    reader.readAsText(file);
  };

  const handleAIActionPlan = async () => {
    if (!editingTask) return;
    await generateAIActionPlan(editingTask.id);
    const updatedTask = useStore.getState().tasks.find(t => t.id === editingTask.id);
    if (updatedTask) {
      setEditingTask(updatedTask);
    }
  };

  // Subtask Handlers
  const handleAddSubtask = () => {
    if (!editingTask) return;
    const newId = crypto.randomUUID();
    const newSubtask = { id: newId, title: '', completed: false };
    const updated = { ...editingTask, subtasks: [...(editingTask.subtasks || []), newSubtask] };
    setEditingTask(updated);
    setEditingSubtaskId(newId);
    setTempSubtaskTitle('');
  };

  const handleStartEditSubtask = (sub: { id: string, title: string }) => {
    setEditingSubtaskId(sub.id);
    setTempSubtaskTitle(sub.title);
  };

  const handleSaveSubtask = (id: string) => {
    if (!editingTask) return;

    let newSubtasks = [...(editingTask.subtasks || [])];

    if (!tempSubtaskTitle.trim()) {
      newSubtasks = newSubtasks.filter(s => s.id !== id);
    } else {
      newSubtasks = newSubtasks.map(s => s.id === id ? { ...s, title: tempSubtaskTitle.trim() } : s);
    }

    const updated = { ...editingTask, subtasks: newSubtasks };
    setEditingTask(updated);
    updateTask(editingTask.id, updated);
    setEditingSubtaskId(null);
    setTempSubtaskTitle('');
  };

  const handleKeyDownSubtask = (e: React.KeyboardEvent, id: string) => {
    if (e.key === 'Enter') {
      handleSaveSubtask(id);
    }
  };

  const completedToday = useMemo(() =>
    tasks.filter(t => {
      if (!t.completed || !t.completedAt) return false;
      const d = new Date(t.completedAt);
      return isValid(d) && isToday(d);
    }).length
    , [tasks]);

  useEffect(() => {
    if (completedToday >= dailyGoal && dailyGoal > 0) {
      const hasCelebratedToday = localStorage.getItem(`celebrated-${format(new Date(), 'yyyy-MM-dd')}`);
      if (!hasCelebratedToday) {
        setShowGoalCelebration(true);
        localStorage.setItem(`celebrated-${format(new Date(), 'yyyy-MM-dd')}`, 'true');
        setTimeout(() => setShowGoalCelebration(false), 5000);
      }
    }
  }, [completedToday, dailyGoal]);

  useEffect(() => {
    updateStreak();
  }, [tasks, updateStreak]);

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      // Don't trigger shortcuts if typing in input
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) return;

      const key = e.key.toLowerCase();

      // Close modal on navigation shortcut
      if (['i', 't', 'f', 's'].includes(key)) {
        setEditingTask(null);
      }

      if (key === 'i') setView('inbox');
      if (key === 't') setView('today');
      if (key === 'f') setView('focus');
      if (key === 's') setView('settings');
      if (key === 'b') setSidebarOpen(prev => !prev);

      if (e.key === '/') {
        e.preventDefault();
        const searchInput = document.getElementById('search-input');
        if (searchInput) {
          searchInput.focus();
        } else {
          // If search input isn't rendered (e.g. in Settings/Help), go to inbox first
          setEditingTask(null);
          setView('inbox');
          setTimeout(() => document.getElementById('search-input')?.focus(), 50);
        }
      }

      if (e.key === 'Escape') {
        setSelectionMode(false);
        setSelectedIds([]);
        setEditingTask(null);
        setSearchQuery('');
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [setView, setSearchQuery]);

  const toggleSelection = (id: string) => {
    setSelectedIds(prev =>
      prev.includes(id) ? prev.filter(i => i !== id) : [...prev, id]
    );
  };

  const filteredTasks = useMemo(() => {
    let result = tasks;

    switch (activeView) {
      case 'today':
        result = result.filter(t => {
          if (t.completed || !t.dueDate) return false;
          const d = new Date(t.dueDate);
          return isValid(d) && isToday(d);
        });
        break;
      case 'upcoming':
        result = result.filter(t => {
          if (t.completed || !t.dueDate) return false;
          const d = new Date(t.dueDate);
          return isValid(d) && (isFuture(d) || isToday(d));
        });
        break;
      case 'overdue':
        result = result.filter(t => !t.completed && isOverdue(t.dueDate));
        break;
      case 'completed':
        result = result.filter(t => t.completed);
        break;
      case 'inbox':
      default:
        result = result.filter(t => !t.completed);
    }

    if (filterTagId) {
      result = result.filter(t => t.tags?.includes(filterTagId));
    }

    if (searchQuery) {
      const q = searchQuery.toLowerCase();
      result = result.filter(t =>
        t.title.toLowerCase().includes(q) ||
        (t.description || '').toLowerCase().includes(q)
      );
    }

    return result;
  }, [tasks, activeView, filterTagId, searchQuery]);

  const sortedTasks = useMemo(() => {
    if (activeView === 'completed') {
      return [...filteredTasks].sort((a, b) => (b.completedAt || '').localeCompare(a.completedAt || ''));
    }
    if (activeView === 'overdue') {
      return [...filteredTasks].sort((a, b) => (a.dueDate || '').localeCompare(b.dueDate || ''));
    }
    return [...filteredTasks].sort((a, b) => a.position - b.position);
  }, [filteredTasks, activeView]);

  const handleReorder = (newOrderedList: Task[]) => {
    reorderTasks(newOrderedList);
  };

  const activeTagName = useMemo(() => {
    if (!filterTagId) return null;
    return tags.find(t => t.id === filterTagId)?.name;
  }, [filterTagId, tags]);

  const renderContent = () => {
    if (activeView === 'focus') return <FocusMode />;
    if (activeView === 'insights') return <Insights />;
    if (activeView === 'help') return <HelpView />;
    if (activeView === 'settings') return (
      <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="p-8 max-w-2xl mx-auto dark:text-neutral-200 pb-32">
        <header className="mb-10">
          <h1 className="text-3xl font-black tracking-tight mb-2">Settings</h1>
          <p className="text-neutral-500">Configure your local productivity engine.</p>
        </header>

        <div className="space-y-8">
          <section className="bg-white dark:bg-neutral-800 rounded-[2.5rem] border border-neutral-100 dark:border-neutral-700 p-8 shadow-sm">
            <h3 className="text-[10px] font-black text-neutral-400 uppercase tracking-[0.2em] mb-8">Interface & Theme</h3>
            <div className="space-y-6">
              <div className="flex items-center justify-between p-5 bg-neutral-50 dark:bg-neutral-900/50 rounded-2xl">
                <div className="flex items-center gap-4">
                  <div className={`w-10 h-10 rounded-xl flex items-center justify-center ${theme === 'dark' ? 'bg-indigo-500/20 text-indigo-400' : 'bg-amber-100 text-amber-500'}`}>
                    {theme === 'light' ? <Sun size={20} /> : <Moon size={20} />}
                  </div>
                  <div>
                    <p className="font-bold text-sm">Appearance Mode</p>
                    <p className="text-xs text-neutral-500">Switch between light and dark.</p>
                  </div>
                </div>
                <button
                  onClick={() => setTheme(theme === 'light' ? 'dark' : 'light')}
                  className={`w-12 h-6 rounded-full transition-colors relative ${theme === 'dark' ? 'bg-accent' : 'bg-neutral-200'}`}
                >
                  <div className={`absolute top-1 w-4 h-4 bg-white rounded-full transition-all ${theme === 'dark' ? 'left-7' : 'left-1'}`} />
                </button>
              </div>

              <div className="p-5 bg-neutral-50 dark:bg-neutral-900/50 rounded-2xl">
                <div className="flex items-center gap-4 mb-4">
                  <div className="w-10 h-10 bg-accent/10 text-accent rounded-xl flex items-center justify-center">
                    <Palette size={20} />
                  </div>
                  <p className="font-bold text-sm">System Accent</p>
                </div>
                <div className="flex flex-wrap items-center gap-3">
                  {['#6366f1', '#10b981', '#f59e0b', '#ec4899', '#3b82f6', '#8b5cf6', '#ef4444'].map(color => (
                    <button
                      key={color}
                      onClick={() => setAccentColor(color)}
                      className={`w-10 h-10 rounded-xl border-2 transition-all ${accentColor === color ? 'scale-110 border-white ring-2 ring-accent' : 'border-transparent opacity-60 hover:opacity-100'}`}
                      style={{ backgroundColor: color }}
                    />
                  ))}
                </div>
              </div>
            </div>
          </section>

          <section className="bg-white dark:bg-neutral-800 rounded-[2.5rem] border border-neutral-100 dark:border-neutral-700 p-8 shadow-sm">
            <h3 className="text-[10px] font-black text-neutral-400 uppercase tracking-[0.2em] mb-8">Momentum Goal</h3>
            <div className="p-5 bg-neutral-50 dark:bg-neutral-900/50 rounded-2xl">
              <div className="flex justify-between items-center mb-4">
                <p className="font-bold text-sm">Daily Target</p>
                <Badge variant="primary" className="px-3 py-1 font-black">{dailyGoal} TASKS</Badge>
              </div>
              <input
                type="range" min="1" max="15" step="1"
                value={dailyGoal}
                onChange={(e) => setDailyGoal(parseInt(e.target.value))}
                className="w-full accent-accent h-2 rounded-full"
              />
            </div>
          </section>

          <section className="bg-white dark:bg-neutral-800 rounded-[2.5rem] border border-neutral-100 dark:border-neutral-700 p-8 shadow-sm">
            <h3 className="text-[10px] font-black text-neutral-400 uppercase tracking-[0.2em] mb-8">Tag Management</h3>
            <div className="space-y-3">
              {tags.map(tag => (
                <div key={tag.id} className="flex items-center gap-4 p-4 bg-neutral-50 dark:bg-neutral-900 rounded-2xl border border-neutral-100 dark:border-neutral-700 group">
                  <input
                    type="color"
                    value={tag.color}
                    onChange={(e) => updateTag(tag.id, tag.name, e.target.value)}
                    className="w-8 h-8 rounded-lg overflow-hidden border-none cursor-pointer bg-transparent"
                  />
                  <input
                    type="text"
                    value={tag.name}
                    onChange={(e) => updateTag(tag.id, e.target.value, tag.color)}
                    className="flex-1 bg-transparent border-none outline-none font-bold text-sm text-neutral-700 dark:text-neutral-200"
                  />
                  <button
                    onClick={() => setConfirmDialog({
                      isOpen: true,
                      title: 'Delete Tag?',
                      message: `Are you sure you want to delete "${tag.name}"? Tasks with this tag will not be deleted.`,
                      isDanger: true,
                      confirmLabel: 'Delete',
                      onConfirm: () => deleteTag(tag.id)
                    })}
                    className="p-2 text-neutral-300 hover:text-rose-500 opacity-0 group-hover:opacity-100 transition-all"
                  >
                    <Trash2 size={16} />
                  </button>
                </div>
              ))}
              <button
                onClick={() => {
                  setInputDialog({
                    isOpen: true,
                    title: 'New Tag Name',
                    placeholder: 'e.g., Work, Personal...',
                    onSubmit: (name) => {
                      setTagColorDialog({ isOpen: true, tagName: name });
                      setSelectedTagColor('#6366f1'); // Reset to default
                      setInputDialog({ isOpen: false, title: '', onSubmit: () => { } });
                    }
                  });
                }}
                className="w-full py-4 border-2 border-dashed border-neutral-100 dark:border-neutral-700 rounded-2xl text-neutral-400 text-xs font-black uppercase tracking-widest hover:border-accent hover:text-accent transition-all"
              >
                <Plus size={16} className="inline mr-2" /> Add New Tag
              </button>
            </div>
          </section>

          <section className="bg-white dark:bg-neutral-800 rounded-[2.5rem] border border-neutral-100 dark:border-neutral-700 p-8 shadow-sm">
            <h3 className="text-[10px] font-black text-neutral-400 uppercase tracking-[0.2em] mb-8">Support</h3>
            <button
              onClick={() => setView('help')}
              className="w-full flex items-center justify-between p-5 bg-neutral-50 dark:bg-neutral-900/50 rounded-2xl hover:bg-neutral-100 dark:hover:bg-neutral-800 transition-colors text-left"
            >
              <div className="flex items-center gap-4">
                <div className="w-10 h-10 bg-accent/10 text-accent rounded-xl flex items-center justify-center">
                  <CircleHelp size={20} />
                </div>
                <div>
                  <p className="font-bold text-sm">Help & Documentation</p>
                  <p className="text-xs text-neutral-500">Learn how to use features and shortcuts.</p>
                </div>
              </div>
              <ChevronRight size={20} className="text-neutral-400" />
            </button>
          </section>

          <section className="bg-white dark:bg-neutral-800 rounded-[2.5rem] border border-neutral-100 dark:border-neutral-700 p-8 shadow-sm">
            <h3 className="text-[10px] font-black text-neutral-400 uppercase tracking-[0.2em] mb-8">Data Controls</h3>
            <div className="grid grid-cols-2 gap-4">
              <button onClick={handleExport} className="flex items-center justify-center gap-3 py-4 bg-neutral-50 dark:bg-neutral-900/50 rounded-2xl hover:bg-neutral-100 dark:hover:bg-neutral-800 transition-colors text-xs font-black uppercase tracking-widest">
                <Download size={18} /> Export Data
              </button>
              <button onClick={() => fileInputRef.current?.click()} className="flex items-center justify-center gap-3 py-4 bg-neutral-50 dark:bg-neutral-900/50 rounded-2xl hover:bg-neutral-100 dark:hover:bg-neutral-800 transition-colors text-xs font-black uppercase tracking-widest">
                <Upload size={18} /> Import Data
              </button>
              <input type="file" ref={fileInputRef} onChange={handleImport} className="hidden" accept=".json" />
            </div>
            <button
              onClick={() => setConfirmDialog({
                isOpen: true,
                title: 'Destroy All Data?',
                message: 'This action cannot be undone. All your tasks, tags, and streaks will be permanently deleted.',
                isDanger: true,
                confirmLabel: 'Destroy Everything',
                onConfirm: () => useStore.getState().resetData()
              })}
              className="w-full mt-4 py-4 bg-rose-50 dark:bg-rose-900/10 text-rose-500 rounded-2xl font-black text-xs uppercase tracking-widest hover:bg-rose-100 dark:hover:bg-rose-900/20 transition-colors"
            >
              Destroy All Data
            </button>
          </section>
        </div>
      </motion.div>
    );

    return (
      <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="max-w-3xl mx-auto px-6 py-12">
        <header className="mb-12 flex flex-col gap-6">
          <div className="flex items-center justify-between">
            <div>
              <h1 className="text-4xl font-black text-neutral-900 dark:text-white tracking-tight capitalize">
                {filterTagId ? activeTagName : (activeView === 'inbox' ? 'My Tasks' : activeView)}
              </h1>
              <p className="text-neutral-500 dark:text-neutral-400 mt-1">
                {sortedTasks.length} task{sortedTasks.length !== 1 ? 's' : ''} {activeView === 'completed' ? 'archived' : 'active'}.
              </p>
            </div>
            <div className="flex items-center gap-2">
              <button
                onClick={() => setViewMode(viewMode === 'list' ? 'calendar' : 'list')}
                className={`p-3 rounded-xl transition-all ${viewMode === 'calendar' ? 'bg-accent text-white shadow-lg' : 'text-neutral-400 hover:bg-neutral-100 dark:hover:bg-neutral-800'}`}
                aria-label="Toggle view"
                title={viewMode === 'list' ? "Switch to Calendar" : "Switch to List"}
              >
                {viewMode === 'calendar' ? <LayoutList size={22} /> : <Calendar size={22} />}
              </button>

              {viewMode === 'list' && (
                <button
                  onClick={() => {
                    setSelectionMode(!selectionMode);
                    setSelectedIds([]);
                  }}
                  className={`p-3 rounded-xl transition-all ${selectionMode ? 'bg-accent text-white shadow-lg' : 'text-neutral-400 hover:bg-neutral-100 dark:hover:bg-neutral-800'}`}
                  aria-label="Selection mode"
                >
                  <ListChecks size={22} />
                </button>
              )}
            </div>
          </div>

          <div className="relative group">
            <Search className="absolute left-5 top-1/2 -translate-y-1/2 text-neutral-400 group-focus-within:text-accent transition-colors" size={20} />
            <input
              id="search-input"
              type="text"
              placeholder="Search tasks, tags, or focus areas... (Press / to focus)"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="w-full bg-white dark:bg-neutral-800/80 border border-neutral-100 dark:border-neutral-700 rounded-3xl py-5 pl-14 pr-4 outline-none focus:ring-4 focus:ring-accent/10 focus:border-accent transition-all text-sm font-bold shadow-sm"
            />
            {searchQuery && (
              <button onClick={() => setSearchQuery('')} className="absolute right-5 top-1/2 -translate-y-1/2 text-neutral-400 hover:text-rose-500 transition-colors">
                <X size={18} />
              </button>
            )}
          </div>
        </header>

        <div className="space-y-8 pb-32">
          {viewMode === 'calendar' ? (
            <CalendarView
              tasks={filteredTasks}
              onEdit={setEditingTask}
              selectedDate={selectedDate}
              onSelectDate={setSelectedDate}
            />
          ) : (
            <div className="space-y-4">
              {!selectionMode && activeView !== 'completed' && activeView !== 'overdue' && !searchQuery && !filterTagId ? (
                <Reorder.Group axis="y" values={sortedTasks} onReorder={handleReorder} className="space-y-4">
                  {sortedTasks.map(task => (
                    <TaskItem
                      key={task.id}
                      task={task}
                      draggable={true}
                      onEdit={setEditingTask}
                      onDelete={(id) => setConfirmDialog({
                        isOpen: true,
                        title: 'Delete Task?',
                        message: 'Are you sure you want to delete this task?',
                        isDanger: true,
                        confirmLabel: 'Delete',
                        onConfirm: () => deleteTask(id)
                      })}
                    />
                  ))}
                </Reorder.Group>
              ) : (
                <AnimatePresence mode="popLayout">
                  {sortedTasks.map(task => (
                    <TaskItem
                      key={task.id}
                      task={task}
                      selectionMode={selectionMode}
                      isSelected={selectedIds.includes(task.id)}
                      onSelect={toggleSelection}
                      onEdit={setEditingTask}
                      onDelete={(id) => setConfirmDialog({
                        isOpen: true,
                        title: 'Delete Task?',
                        message: 'Are you sure you want to delete this task?',
                        isDanger: true,
                        confirmLabel: 'Delete',
                        onConfirm: () => deleteTask(id)
                      })}
                    />
                  ))}
                </AnimatePresence>
              )}
            </div>
          )}

          {sortedTasks.length === 0 && viewMode === 'list' && (
            <motion.div initial={{ opacity: 0, scale: 0.9 }} animate={{ opacity: 1, scale: 1 }} className="py-24 text-center">
              <div className="w-20 h-20 bg-neutral-100 dark:bg-neutral-800 text-neutral-300 dark:text-neutral-600 rounded-[2rem] flex items-center justify-center mx-auto mb-6">
                <Filter size={40} />
              </div>
              <h3 className="text-lg font-bold text-neutral-800 dark:text-neutral-100">No matches found</h3>
              <p className="text-neutral-400 mt-2 max-w-xs mx-auto">Try clearing your filters or changing your search query.</p>
              {(searchQuery || filterTagId) && (
                <button
                  onClick={() => { setSearchQuery(''); setFilterTagId(null); }}
                  className="mt-6 px-6 py-3 bg-accent/5 hover:bg-accent/10 text-accent rounded-2xl text-xs font-black uppercase tracking-widest transition-all"
                >
                  Reset all filters
                </button>
              )}
            </motion.div>
          )}
        </div>

        {selectionMode && selectedIds.length > 0 && viewMode === 'list' && (
          <motion.div initial={{ y: 100 }} animate={{ y: 0 }} exit={{ y: 100 }} className="fixed bottom-10 left-0 lg:left-64 right-0 z-50 flex justify-center pointer-events-none">
            <div className="flex items-center gap-6 bg-neutral-900 dark:bg-neutral-800 text-white px-10 py-6 rounded-[2.5rem] shadow-2xl border border-neutral-700 pointer-events-auto">
              <div className="flex flex-col">
                <span className="text-[10px] font-black text-neutral-400 uppercase tracking-widest">Selected</span>
                <span className="text-sm font-black">{selectedIds.length} Tasks</span>
              </div>
              <div className="h-8 w-[1px] bg-neutral-700 mx-2" />
              <div className="flex items-center gap-4">
                <button onClick={() => { bulkToggle(selectedIds, true); setSelectionMode(false); }} className="flex items-center gap-2 px-5 py-2.5 bg-emerald-500/10 hover:bg-emerald-500/20 text-emerald-400 rounded-2xl transition-all text-xs font-black uppercase tracking-widest">
                  <CheckCircle size={18} /> Finish
                </button>
                <button onClick={() => setConfirmDialog({
                  isOpen: true,
                  title: 'Delete Tasks?',
                  message: `Are you sure you want to permanently delete ${selectedIds.length} tasks?`,
                  isDanger: true,
                  confirmLabel: 'Delete',
                  onConfirm: () => { bulkDelete(selectedIds); setSelectionMode(false); }
                })} className="flex items-center gap-2 px-5 py-2.5 bg-rose-500/10 hover:bg-rose-500/20 text-rose-400 rounded-2xl transition-all text-xs font-black uppercase tracking-widest">
                  <Trash2 size={18} /> Delete
                </button>
                <button onClick={() => { setSelectionMode(false); setSelectedIds([]); }} className="p-3 bg-white/5 hover:bg-white/10 rounded-2xl transition-all text-neutral-400">
                  <X size={20} />
                </button>
              </div>
            </div>
          </motion.div>
        )}
      </motion.div>
    );
  };
  if (loading) return <div>Loading...</div>;

  if (!user) {
  return (
    <Routes>
      <Route path="/login" element={<Login />} />
      <Route path="/register" element={<Register />} />
      <Route path="/forgot-password" element={<ForgotPassword />} /> {/* ✅ ADD THIS */}
      <Route path="*" element={<Navigate to="/login" replace />} />
    </Routes>
  );
}

  return (
    <div className={`flex h-screen w-full bg-neutral-50 dark:bg-neutral-900 overflow-hidden text-neutral-900 dark:text-neutral-100 transition-colors`}>

      {/* Global Dialogs */}
      <ConfirmDialog
        isOpen={confirmDialog.isOpen}
        onClose={() => setConfirmDialog({ ...confirmDialog, isOpen: false })}
        title={confirmDialog.title}
        message={confirmDialog.message}
        onConfirm={confirmDialog.onConfirm}
        isDanger={confirmDialog.isDanger}
        confirmLabel={confirmDialog.confirmLabel}
      />

      <InputDialog
        isOpen={inputDialog.isOpen}
        onClose={() => setInputDialog({ ...inputDialog, isOpen: false })}
        onSubmit={inputDialog.onSubmit}
        title={inputDialog.title}
        placeholder={inputDialog.placeholder}
      />

      <AlertDialog
        isOpen={alertDialog.isOpen}
        onClose={() => setAlertDialog({ ...alertDialog, isOpen: false })}
        title={alertDialog.title}
        message={alertDialog.message}
      />

      {/* Tag Color Picker Modal */}
      {tagColorDialog.isOpen && (
        <div className="fixed inset-0 z-50 bg-black/50 backdrop-blur-sm flex items-center justify-center">
          <div className="bg-white dark:bg-neutral-800 rounded-3xl shadow-2xl p-8 w-96 border border-neutral-200 dark:border-neutral-700">
            <h3 className="text-lg font-bold mb-2 text-neutral-900 dark:text-white">
              Choose Color for "{tagColorDialog.tagName}"
            </h3>
            <p className="text-sm text-neutral-500 dark:text-neutral-400 mb-6">
              Select a color for your new tag
            </p>

            <div className="grid grid-cols-3 gap-3 mb-8">
              {TAG_COLORS.map((color) => (
                <button
                  key={color}
                  onClick={() => setSelectedTagColor(color)}
                  className={`w-full aspect-square rounded-2xl transition-all transform ${
                    selectedTagColor === color
                      ? 'ring-4 ring-offset-2 dark:ring-offset-neutral-800 scale-110'
                      : 'hover:scale-105'
                  }`}
                  style={{
                    backgroundColor: color,
                  }}
                />
              ))}
            </div>

            <div className="flex gap-3">
              <button
                onClick={() => setTagColorDialog({ isOpen: false, tagName: '' })}
                className="flex-1 px-4 py-3 rounded-2xl bg-neutral-100 dark:bg-neutral-700 text-neutral-700 dark:text-neutral-200 font-bold text-sm hover:bg-neutral-200 dark:hover:bg-neutral-600 transition-colors"
              >
                Cancel
              </button>
              <button
                onClick={() => {
                  addTag(tagColorDialog.tagName, selectedTagColor);
                  setTagColorDialog({ isOpen: false, tagName: '' });
                }}
                className="flex-1 px-4 py-3 rounded-2xl bg-accent text-white font-bold text-sm hover:opacity-90 transition-opacity"
              >
                Create Tag
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Sidebar - Hidden on mobile unless toggled */}
      <div
        className={`
          fixed inset-y-0 left-0 z-30 h-full bg-neutral-50 dark:bg-neutral-900
          transition-all duration-300 ease-in-out
          lg:relative
          ${sidebarOpen ? 'translate-x-0' : '-translate-x-full'}
          ${sidebarOpen ? 'lg:translate-x-0 lg:w-64' : 'lg:translate-x-0 lg:w-0 lg:overflow-hidden'}
        `}
      >
        <div className="w-64 h-full">
          <Sidebar
            onNavigate={handleMobileNav}
            onAddTagRequest={() => setInputDialog({
              isOpen: true,
              title: 'New Tag Name',
              placeholder: 'e.g., Work, Personal...',
              onSubmit: (name) => {
                setTagColorDialog({ isOpen: true, tagName: name });
                setSelectedTagColor('#6366f1');
                setInputDialog({ isOpen: false, title: '', onSubmit: () => { } });
              }
            })}
          />
        </div>
      </div>

      {/* Mobile Sidebar Overlay */}
      {sidebarOpen && (
        <div
          className="fixed inset-0 z-20 bg-black/20 backdrop-blur-sm lg:hidden"
          onClick={() => setSidebarOpen(false)}
        />
      )}

      {/* Main Content Area */}
      <main className="flex-1 h-full overflow-y-auto relative w-full" id="main-scroll">
        {/* Mobile Header for Sidebar Toggle */}
        {!sidebarOpen && (
          <button
            onClick={() => setSidebarOpen(true)}
            className="lg:hidden absolute top-6 left-6 z-10 p-2 text-neutral-400 hover:text-neutral-900 dark:hover:text-white transition-colors"
          >
            <Menu size={24} />
          </button>
        )}

        {renderContent()}

        {/* Floating Task Input for Task Views */}
        {(!activeView || ['inbox', 'today', 'upcoming', 'overdue'].includes(activeView)) && !filterTagId && !searchQuery && (
          <div className="fixed bottom-6 left-0 lg:left-64 right-0 z-20 pointer-events-none">
            <div className="pointer-events-auto">
              <TaskInput defaultDate={viewMode === 'calendar' ? selectedDate : undefined} />
            </div>
          </div>
        )}
      </main>

      {/* Goal Celebration Overlay */}
      <AnimatePresence>
        {showGoalCelebration && (
          <motion.div
            initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
            className="fixed inset-0 z-[100] flex items-center justify-center pointer-events-none"
          >
            <div className="bg-white dark:bg-neutral-800 px-10 py-12 rounded-[3rem] shadow-2xl flex flex-col items-center gap-6 border border-accent border-4">
              <motion.div initial={{ scale: 0 }} animate={{ scale: 1, rotate: 360 }} className="w-20 h-20 bg-accent text-white rounded-3xl flex items-center justify-center">
                <Zap size={40} fill="currentColor" />
              </motion.div>
              <div className="text-center">
                <h2 className="text-3xl font-black text-neutral-900 dark:text-white tracking-tighter">Daily Goal Achieved!</h2>
                <p className="text-neutral-500 mt-2 font-bold uppercase tracking-widest text-sm">Momentum Peak Reached</p>
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      <AnimatePresence>
        {editingTask && (
          <div className="fixed inset-0 z-[60] flex items-center justify-center p-6 sm:p-12">
            <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} onClick={() => setEditingTask(null)} className="absolute inset-0 bg-neutral-900/60 backdrop-blur-md" />
            <motion.div initial={{ opacity: 0, scale: 0.95, y: 20 }} animate={{ opacity: 1, scale: 1, y: 0 }} exit={{ opacity: 0, scale: 0.95, y: 20 }} className="relative w-full max-w-xl bg-white dark:bg-neutral-800 rounded-[3.5rem] shadow-2xl overflow-hidden flex flex-col border border-neutral-200 dark:border-neutral-700">
              <div className="p-10 space-y-8 max-h-[90vh] overflow-y-auto">
                <div className="flex items-center justify-between">
                  <Badge variant="primary" className="uppercase tracking-[0.2em] text-[10px] font-black px-4 py-1.5">Edit Momentum</Badge>
                  <button onClick={() => setEditingTask(null)} className="p-3 hover:bg-neutral-100 dark:hover:bg-neutral-700 rounded-2xl transition-all text-neutral-400">
                    <X size={20} />
                  </button>
                </div>

                <div className="space-y-4">
                  <input type="text" value={editingTask.title} onChange={(e) => setEditingTask({ ...editingTask, title: e.target.value })} className="w-full text-3xl font-black bg-transparent outline-none text-neutral-900 dark:text-white placeholder:opacity-20" placeholder="Title of mission..." />
                  <textarea value={editingTask.description || ''} onChange={(e) => setEditingTask({ ...editingTask, description: e.target.value })} placeholder="Capture complex details or links..." className="w-full h-32 bg-neutral-50 dark:bg-neutral-900 p-6 rounded-[2rem] text-sm font-medium resize-none outline-none dark:text-neutral-300 border-none focus:ring-4 focus:ring-accent/5 transition-all" />
                </div>

                <div className="space-y-6">
                  <div className="flex items-center justify-between">
                    <h4 className="text-[10px] font-black text-neutral-400 uppercase tracking-[0.2em] px-2">Sub-Steps Breakdown</h4>
                    <button
                      onClick={handleAIActionPlan}
                      disabled={editingTask.aiBreakdownRequested}
                      className="flex items-center gap-2 px-4 py-2.5 bg-accent/5 hover:bg-accent/10 text-accent rounded-2xl text-[10px] font-black transition-all border border-accent/20"
                    >
                      {editingTask.aiBreakdownRequested ? <Loader2 size={14} className="animate-spin" /> : <Sparkles size={14} />}
                      AI BREAKDOWN
                    </button>
                  </div>
                  <div className="space-y-3">
                    {editingTask.subtasks && editingTask.subtasks.map(sub => (
                      <div key={sub.id} className={`flex items-center gap-4 p-4 bg-neutral-50 dark:bg-neutral-900 rounded-2xl border ${editingSubtaskId === sub.id ? 'border-accent shadow-sm ring-1 ring-accent/20' : 'border-neutral-100 dark:border-neutral-800 hover:border-accent/30'} group transition-all`}>
                        <button
                          onClick={() => {
                            toggleSubtask(editingTask.id, sub.id);
                            const updated = useStore.getState().tasks.find(t => t.id === editingTask.id);
                            if (updated) setEditingTask(updated);
                          }}
                          className={`w-6 h-6 rounded-full border-2 flex items-center justify-center flex-shrink-0 transition-all ${sub.completed ? 'bg-emerald-500 border-emerald-500' : 'border-neutral-300 hover:border-accent'}`}
                        >
                          {sub.completed && <Check size={14} className="text-white" strokeWidth={3} />}
                        </button>

                        <div className="flex-1 min-w-0">
                          {editingSubtaskId === sub.id ? (
                            <input
                              ref={editInputRef}
                              type="text"
                              value={tempSubtaskTitle}
                              onChange={(e) => setTempSubtaskTitle(e.target.value)}
                              onBlur={() => handleSaveSubtask(sub.id)}
                              onKeyDown={(e) => handleKeyDownSubtask(e, sub.id)}
                              className="w-full bg-transparent border-none outline-none text-sm font-medium text-neutral-900 dark:text-white"
                              placeholder="Subtask title..."
                            />
                          ) : (
                            <span
                              className={`text-sm font-medium block truncate ${sub.completed ? 'line-through text-neutral-400' : 'text-neutral-700 dark:text-neutral-200 cursor-text'}`}
                              onClick={() => handleStartEditSubtask(sub)}
                            >
                              {sub.title}
                            </span>
                          )}
                        </div>

                        <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                          <button
                            onClick={() => handleStartEditSubtask(sub)}
                            className="p-2 text-neutral-400 hover:text-accent hover:bg-accent/10 rounded-lg transition-colors"
                            title="Edit step"
                          >
                            <Edit2 size={16} />
                          </button>
                          <button
                            onClick={() => {
                              const newSubtasks = editingTask.subtasks.filter(s => s.id !== sub.id);
                              const updated = { ...editingTask, subtasks: newSubtasks };
                              setEditingTask(updated);
                              updateTask(editingTask.id, updated);
                            }}
                            className="p-2 text-neutral-400 hover:text-rose-500 hover:bg-rose-50 dark:hover:bg-rose-900/20 rounded-lg transition-colors"
                            title="Delete step"
                          >
                            <Trash2 size={16} />
                          </button>
                        </div>
                      </div>
                    ))}
                    <button
                      onClick={handleAddSubtask}
                      className="w-full flex items-center justify-center gap-3 p-4 border-2 border-dashed border-neutral-300 dark:border-neutral-700 rounded-2xl text-neutral-400 hover:text-accent hover:border-accent transition-all text-xs font-black uppercase tracking-widest"
                    >
                      <Plus size={16} /> Add Step
                    </button>
                  </div>
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-3 gap-6 pt-4">
                  <div className="space-y-3">
                    <label className="text-[10px] font-black text-neutral-400 uppercase tracking-[0.2em] px-2">Timeline</label>
                    <div className="relative">
                      <Calendar size={16} className="absolute left-4 top-1/2 -translate-y-1/2 text-neutral-400" />
                      <input type="date" value={editingTask.dueDate ? editingTask.dueDate.split('T')[0] : ''} onChange={(e) => setEditingTask({ ...editingTask, dueDate: e.target.value ? new Date(e.target.value).toISOString() : null })} className="w-full bg-neutral-50 dark:bg-neutral-900 py-4 pl-12 pr-4 rounded-2xl text-sm font-bold outline-none dark:text-neutral-300 border-none focus:ring-4 focus:ring-accent/5 transition-all appearance-none" />
                    </div>
                  </div>

                  <div className="space-y-3">
                    <label className="text-[10px] font-black text-neutral-400 uppercase tracking-[0.2em] px-2">Recurrence</label>
                    <div className="relative">
                      <Repeat size={16} className="absolute left-4 top-1/2 -translate-y-1/2 text-neutral-400" />
                      <select
                        value={editingTask.recurrence || ''}
                        onChange={(e) => setEditingTask({ ...editingTask, recurrence: (e.target.value || null) as Recurrence })}
                        className="w-full bg-neutral-50 dark:bg-neutral-900 py-4 pl-12 pr-4 rounded-2xl text-sm font-bold outline-none dark:text-neutral-300 border-none focus:ring-4 focus:ring-accent/5 transition-all appearance-none"
                      >
                        <option value="">One-off</option>
                        <option value="daily">Daily</option>
                        <option value="weekly">Weekly</option>
                        <option value="monthly">Monthly</option>
                      </select>
                    </div>
                  </div>

                  <div className="space-y-3">
                    <label className="text-[10px] font-black text-neutral-400 uppercase tracking-[0.2em] px-2">Urgency</label>
                    <div className="relative">
                      <Flag size={16} className="absolute left-4 top-1/2 -translate-y-1/2 text-neutral-400" />
                      <select value={editingTask.priority} onChange={(e) => setEditingTask({ ...editingTask, priority: e.target.value as Priority })} className="w-full bg-neutral-50 dark:bg-neutral-900 py-4 pl-12 pr-4 rounded-2xl text-sm font-bold outline-none dark:text-neutral-300 border-none focus:ring-4 focus:ring-accent/5 transition-all appearance-none">
                        <option value={Priority.LOW}>Low Intensity</option>
                        <option value={Priority.MEDIUM}>Standard Priority</option>
                        <option value={Priority.HIGH}>Critical Mission</option>
                      </select>
                    </div>
                  </div>
                </div>

                <div className="pt-8 border-t border-neutral-100 dark:border-neutral-700 flex justify-end gap-4">
                  <button onClick={() => { updateTask(editingTask.id, editingTask); setEditingTask(null); }} className="flex-1 flex items-center justify-center gap-3 px-8 py-5 bg-accent text-white rounded-3xl font-black text-sm shadow-2xl shadow-accent/30 hover:scale-[1.02] transition-all active:scale-95">
                    <Save size={20} /> Update Momentum
                  </button>
                </div>
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>
    </div>
  );
};

export default App;