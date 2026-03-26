import React, { useState, useEffect } from 'react';
import { 
  Shield, 
  AlertTriangle, 
  FileText, 
  CheckSquare, 
  BarChart3, 
  Bell, 
  BookOpen, 
  Menu, 
  X,
  Plus,
  User as UserIcon,
  LogOut,
  ChevronRight,
  ArrowLeft,
  MapPin,
  Clock,
  AlertCircle,
  Camera,
  Image as ImageIcon,
  Share2,
  Copy,
  Check,
  RefreshCw,
  LogIn,
  Settings,
  ShieldAlert
} from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import { 
  BarChart, 
  Bar, 
  XAxis, 
  YAxis, 
  CartesianGrid, 
  Tooltip, 
  ResponsiveContainer,
  PieChart,
  Pie,
  Cell
} from 'recharts';
import { format } from 'date-fns';
import { cn } from './lib/utils';
import { User, Incident, Academy, Action, Inspection, KnowledgeItem, Role, Notification } from './types';
import { 
  auth, 
  db, 
  googleProvider, 
  handleFirestoreError, 
  OperationType 
} from './firebase';
import { 
  signInWithPopup, 
  onAuthStateChanged, 
  signOut 
} from 'firebase/auth';
import { 
  collection, 
  onSnapshot, 
  query, 
  orderBy, 
  addDoc, 
  updateDoc, 
  deleteDoc,
  doc, 
  Timestamp, 
  serverTimestamp,
  setDoc, 
  getDoc,
  getDocs,
  where
} from 'firebase/firestore';

// --- Components ---

const Card = ({ children, className, ...props }: React.HTMLAttributes<HTMLDivElement>) => (
  <div className={cn("bg-white rounded-2xl border border-black/5 shadow-sm overflow-hidden", className)} {...props}>
    {children}
  </div>
);

const Badge = ({ children, variant = 'default', className }: { children: React.ReactNode; variant?: 'default' | 'warning' | 'error' | 'success' | 'info', className?: string }) => {
  const variants = {
    default: "bg-slate-100 text-slate-700",
    warning: "bg-amber-100 text-amber-700",
    error: "bg-rose-100 text-rose-700",
    success: "bg-emerald-100 text-emerald-700",
    info: "bg-indigo-100 text-indigo-700",
  };
  return (
    <span className={cn("px-2 py-0.5 rounded-full text-xs font-medium", variants[variant], className)}>
      {children}
    </span>
  );
};

// --- Main App ---

// Utility for image compression
const compressImage = (base64Str: string, maxWidth = 800, maxHeight = 800, quality = 0.7): Promise<string> => {
  return new Promise((resolve) => {
    const img = new Image();
    img.src = base64Str;
    img.onload = () => {
      const canvas = document.createElement('canvas');
      let width = img.width;
      let height = img.height;

      if (width > height) {
        if (width > maxWidth) {
          height *= maxWidth / width;
          width = maxWidth;
        }
      } else {
        if (height > maxHeight) {
          width *= maxHeight / height;
          height = maxHeight;
        }
      }

      canvas.width = width;
      canvas.height = height;
      const ctx = canvas.getContext('2d');
      ctx?.drawImage(img, 0, 0, width, height);
      resolve(canvas.toDataURL('image/jpeg', quality));
    };
  });
};

export default function App() {
  const [activeTab, setActiveTab] = useState('dashboard');
  const [currentUser, setCurrentUser] = useState<User | null>(null);
  const [authReady, setAuthReady] = useState(false);
  const [users, setUsers] = useState<User[]>([]);
  const [academies, setAcademies] = useState<Academy[]>([]);
  const [incidents, setIncidents] = useState<Incident[]>([]);
  const [actions, setActions] = useState<Action[]>([]);
  const [inspections, setInspections] = useState<Inspection[]>([]);
  const [knowledge, setKnowledge] = useState<KnowledgeItem[]>([]);
  const [stats, setStats] = useState<any>(null);
  const [isSidebarOpen, setIsSidebarOpen] = useState(false);
  const [showReportModal, setShowReportModal] = useState(false);
  const [photoBase64, setPhotoBase64] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isSyncing, setIsSyncing] = useState(false);
  const [selectedAcademy, setSelectedAcademy] = useState<string>('All Units');
  const [lastUpdated, setLastUpdated] = useState<Date>(new Date());
  const [showSyncToast, setShowSyncToast] = useState(false);
  const [selectedIncident, setSelectedIncident] = useState<Incident | null>(null);
  const [showDetailModal, setShowDetailModal] = useState(false);
  const [notifications, setNotifications] = useState<Notification[]>([]);
  const [showNotifications, setShowNotifications] = useState(false);

  // Auth Listener
  useEffect(() => {
    const unsubscribe = onAuthStateChanged(auth, async (firebaseUser) => {
      if (firebaseUser) {
        // Check if user exists in Firestore
        const userDoc = await getDoc(doc(db, 'users', firebaseUser.uid));
        if (userDoc.exists()) {
          const userData = userDoc.data();
          
          // Ensure admin role is up to date for the specific admin email
          if (firebaseUser.email === 'kharkabdr80@gmail.com' && userData.role !== 'HQ_ADMIN') {
            await updateDoc(doc(db, 'users', firebaseUser.uid), { role: 'HQ_ADMIN' });
            userData.role = 'HQ_ADMIN';
          }

          // Migration for legacy academy_id '6' or empty
          if (userData.academy_id === '6' || !userData.academy_id || userData.academy_id.trim() === '') {
            const academiesSnap = await getDocs(collection(db, 'academies'));
            const ghq = academiesSnap.docs.find(d => d.data().name === 'GHQ');
            if (ghq) {
              await updateDoc(doc(db, 'users', firebaseUser.uid), { academy_id: ghq.id });
              userData.academy_id = ghq.id;
            }
          }
          
          // Fetch academy name for the user
          let academyName = 'Unknown Unit';
          if (userData.academy_id && userData.academy_id.trim() !== '') {
            try {
              const academyDoc = await getDoc(doc(db, 'academies', userData.academy_id));
              if (academyDoc.exists()) {
                academyName = academyDoc.data().name;
              }
            } catch (err) {
              console.error("Error fetching academy name:", err);
            }
          }
          
          const userDataFull = { id: firebaseUser.uid, ...userData, academy_name: academyName } as any;
          setCurrentUser(userDataFull);
          
          // Set default tab based on role
          setActiveTab('dashboard');
        } else {
          // Find GHQ academy ID for default
          const academiesSnap = await getDocs(collection(db, 'academies'));
          const ghq = academiesSnap.docs.find(d => d.data().name === 'GHQ');
          
          // New user - default to STUDENT role for safety
          const newUser: any = {
            name: firebaseUser.displayName || 'Anonymous User',
            role: firebaseUser.email === 'kharkabdr80@gmail.com' ? 'HQ_ADMIN' : 'STUDENT',
            academy_id: ghq ? ghq.id : '', 
            email: firebaseUser.email,
            created_at: Timestamp.now()
          };
          await setDoc(doc(db, 'users', firebaseUser.uid), newUser);
          const newUserFull = { id: firebaseUser.uid, ...newUser, academy_name: ghq ? ghq.data().name : 'Unknown Unit' };
          setCurrentUser(newUserFull);
          
          // Set default tab based on role
          setActiveTab('dashboard');
        }
      } else {
        setCurrentUser(null);
      }
      setAuthReady(true);
    });
    return () => unsubscribe();
  }, []);

  // Seed and Cleanup academies (Admin only)
  useEffect(() => {
    const manageAcademies = async () => {
      if (authReady && currentUser?.role === 'HQ_ADMIN') {
        const initialAcademies = [
          { name: "Pemathang Academy", logo: "/input_file_0.png" },
          { name: "Gyalpozhing Academy", logo: "/input_file_4.png" },
          { name: "Khotokha Academy", logo: "/input_file_3.png" },
          { name: "Jamtsholing Academy", logo: "/input_file_2.png" },
          { name: "Tareythang Academy", logo: "/input_file_1.png" },
          { name: "GHQ", logo: "/input_file_1.png" }
        ];
        
        const snapshot = await getDocs(collection(db, 'academies'));
        
        if (snapshot.empty) {
          // Seed if empty
          for (const academy of initialAcademies) {
            await addDoc(collection(db, 'academies'), academy);
          }
        } else {
          // Update existing and cleanup duplicates
          const seen = new Set();
          const duplicates: string[] = [];
          
          for (const docSnap of snapshot.docs) {
            const data = docSnap.data();
            const name = data.name;
            
            if (seen.has(name)) {
              duplicates.push(docSnap.id);
            } else {
              seen.add(name);
              // Check if logo needs update
              const initialData = initialAcademies.find(a => a.name === name);
              if (initialData && !data.logo) {
                await updateDoc(doc(db, 'academies', docSnap.id), { logo: initialData.logo });
              }
            }
          }
          
          if (duplicates.length > 0) {
            console.log(`Cleaning up ${duplicates.length} duplicate academies...`);
            for (const id of duplicates) {
              try {
                await deleteDoc(doc(db, 'academies', id));
              } catch (err) {
                console.error("Failed to delete duplicate academy", id, err);
              }
            }
          }
        }
      }
    };
    manageAcademies();
  }, [authReady, currentUser, academies.length]);

  // Real-time Data Listeners
  useEffect(() => {
    if (!currentUser) return;

    const unsubAcademies = onSnapshot(collection(db, 'academies'), (snapshot) => {
      const data = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() } as any));
      setAcademies(data);
    }, (err) => handleFirestoreError(err, OperationType.LIST, 'academies'));

    const unsubUsers = onSnapshot(collection(db, 'users'), (snapshot) => {
      const data = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() } as any));
      setUsers(data);
    }, (err) => handleFirestoreError(err, OperationType.LIST, 'users'));

    setIsSyncing(true);
    const unsubIncidents = onSnapshot(collection(db, 'incidents'), (snapshot) => {
      console.log(`Fetched ${snapshot.docs.length} incidents`);
      setIsSyncing(true);
      const data = snapshot.docs.map(doc => {
        try {
          const d = doc.data();
          const parseDate = (val: any) => {
            if (!val) return null;
            if (typeof val.toDate === 'function') return val.toDate().toISOString();
            return val; // Assume it's already a string or something else
          };
          
          const createdAt = parseDate(d.created_at) || new Date().toISOString();
          const updatedAt = parseDate(d.updated_at) || createdAt;
          
          return { 
            id: doc.id, 
            ...d, 
            created_at: createdAt,
            updated_at: updatedAt
          } as any;
        } catch (e) {
          console.error(`Error parsing incident ${doc.id}:`, e);
          return null;
        }
      }).filter(Boolean);
      
      // Sort by updated_at descending to show most recently active incidents first
      data.sort((a, b) => {
        const timeA = new Date(a.updated_at).getTime();
        const timeB = new Date(b.updated_at).getTime();
        return (isNaN(timeB) ? 0 : timeB) - (isNaN(timeA) ? 0 : timeA);
      });
      
      setIncidents(data);
      setLastUpdated(new Date());
      setShowSyncToast(true);
      setIsSyncing(false);
      setTimeout(() => setShowSyncToast(false), 3000);
    }, (err) => {
      setIsSyncing(false);
      handleFirestoreError(err, OperationType.LIST, 'incidents');
    });

    const unsubActions = onSnapshot(collection(db, 'actions'), (snapshot) => {
      const data = snapshot.docs.map(doc => {
        const d = doc.data();
        return { 
          id: doc.id, 
          ...d, 
          due_date: d.due_date?.toDate?.()?.toISOString() || new Date().toISOString() 
        } as any;
      });
      setActions(data);
    }, (err) => handleFirestoreError(err, OperationType.LIST, 'actions'));

    const unsubInspections = onSnapshot(collection(db, 'inspections'), (snapshot) => {
      const data = snapshot.docs.map(doc => {
        const d = doc.data();
        return { 
          id: doc.id, 
          ...d, 
          created_at: d.created_at?.toDate?.()?.toISOString() || new Date().toISOString() 
        } as any;
      });
      setInspections(data);
    }, (err) => handleFirestoreError(err, OperationType.LIST, 'inspections'));

    const unsubKnowledge = onSnapshot(collection(db, 'knowledge_base'), (snapshot) => {
      const data = snapshot.docs.map(doc => {
        const d = doc.data();
        return { 
          id: doc.id, 
          ...d, 
          created_at: d.created_at?.toDate?.()?.toISOString() || new Date().toISOString() 
        } as any;
      });
      setKnowledge(data);
    }, (err) => handleFirestoreError(err, OperationType.LIST, 'knowledge_base'));

    const unsubNotifications = onSnapshot(
      query(collection(db, 'notifications'), where('user_id', '==', currentUser.id), orderBy('created_at', 'desc')),
      (snapshot) => {
        const data = snapshot.docs.map(doc => {
          const d = doc.data();
          return { 
            id: doc.id, 
            ...d, 
            created_at: d.created_at?.toDate?.()?.toISOString() || new Date().toISOString() 
          } as any;
        });
        setNotifications(data);
      },
      (err) => handleFirestoreError(err, OperationType.LIST, 'notifications')
    );

    return () => {
      unsubAcademies();
      unsubUsers();
      unsubIncidents();
      unsubActions();
      unsubInspections();
      unsubKnowledge();
      unsubNotifications();
    };
  }, [currentUser]);

  // Calculate Stats
  useEffect(() => {
    if (academies.length === 0) return;

    const total = incidents.length;
    const resolved = incidents.filter(i => i.status === 'Resolved').length;
    
    const byTypeMap: any = {};
    incidents.forEach(i => {
      byTypeMap[i.type] = (byTypeMap[i.type] || 0) + 1;
    });
    const byType = Object.keys(byTypeMap).map(type => ({ type, count: byTypeMap[type] }));

    const byAcademyMap: any = {};
    // Initialize map with all academies to ensure they show up even with 0 incidents
    academies.forEach(a => {
      byAcademyMap[a.name] = 0;
    });
    
    incidents.forEach(i => {
      const name = i.academy_name || 'Unknown Unit';
      if (byAcademyMap[name] !== undefined) {
        byAcademyMap[name]++;
      } else {
        // Fallback for legacy data or unknown units
        byAcademyMap[name] = (byAcademyMap[name] || 0) + 1;
      }
    });
    
    const byAcademy = Object.keys(byAcademyMap).map(name => ({ name, count: byAcademyMap[name] }));

    setStats({ total, resolved, byType, byAcademy });
  }, [incidents, academies]);

  const handleLogin = async () => {
    try {
      await signInWithPopup(auth, googleProvider);
    } catch (err) {
      console.error("Login failed", err);
    }
  };

  const handleLogout = async () => {
    try {
      await signOut(auth);
    } catch (err) {
      console.error("Logout failed", err);
    }
  };

  const updateProfile = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    if (!currentUser) return;
    setIsSubmitting(true);
    try {
      const formData = new FormData(e.currentTarget);
      const name = formData.get('name') as string;
      const academyId = formData.get('academy_id') as string;
      const academy = academies.find(a => a.id === academyId);

      const updates = {
        name,
        academy_id: academyId
      };

      await updateDoc(doc(db, 'users', currentUser.id), updates);
      setCurrentUser({ 
        ...currentUser, 
        name, 
        academy_id: academyId, 
        academy_name: academy?.name || 'Unknown Unit' 
      });
      alert('Profile updated successfully!');
    } catch (err) {
      handleFirestoreError(err, OperationType.UPDATE, `users/${currentUser.id}`);
    } finally {
      setIsSubmitting(false);
    }
  };

  const handlePhotoUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      const reader = new FileReader();
      reader.onloadend = async () => {
        const base64 = reader.result as string;
        try {
          const compressed = await compressImage(base64);
          setPhotoBase64(compressed);
        } catch (err) {
          console.error("Image compression failed:", err);
          setPhotoBase64(base64);
        }
      };
      reader.readAsDataURL(file);
    }
  };

  const handleReportIncident = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    if (!currentUser) return;
    
    const formData = new FormData(e.currentTarget);
    const academyId = formData.get('academy_id') as string;
    const academy = academies.find(a => a.id === academyId);
    
    if (!academy) {
      alert("Error: Your account is not properly assigned to a valid Unit. Please update your profile in Settings.");
      return;
    }

    setIsSubmitting(true);
    try {
      const type = formData.get('type') === 'Other' ? formData.get('custom_type') : formData.get('type');
      
      const data = {
        academy_id: academyId,
        academy_name: academy.name,
        reporter_id: currentUser.id,
        reporter_name: currentUser.name,
        type: type as string,
        severity: formData.get('severity') as string,
        location: formData.get('location') as string,
        description: formData.get('description') as string,
        immediate_action: formData.get('immediate_action') as string,
        ga_recommendation: formData.get('ga_recommendation') as string,
        photo: photoBase64,
        status: 'Open',
        created_at: serverTimestamp(),
        updated_at: serverTimestamp()
      };

      await addDoc(collection(db, 'incidents'), data);
      setShowReportModal(false);
      setPhotoBase64(null);
    } catch (err) {
      handleFirestoreError(err, OperationType.CREATE, 'incidents');
    } finally {
      setIsSubmitting(false);
    }
  };

  const updateIncidentStatus = async (id: string, status: string) => {
    try {
      const incident = incidents.find(i => i.id === id);
      await updateDoc(doc(db, 'incidents', id), { 
        status,
        updated_at: serverTimestamp()
      });

      if (incident) {
        // Create notification for the reporter
        await addDoc(collection(db, 'notifications'), {
          user_id: incident.reporter_id,
          title: 'Incident Status Updated',
          message: `Your incident (${incident.type}) status has been changed to: ${status}`,
          type: 'status_change',
          related_id: id,
          read: false,
          created_at: serverTimestamp()
        });
      }
    } catch (err) {
      handleFirestoreError(err, OperationType.UPDATE, `incidents/${id}`);
    }
  };

  const updateGARecommendation = async (id: string, recommendation: string) => {
    try {
      const incident = incidents.find(i => i.id === id);
      await updateDoc(doc(db, 'incidents', id), { 
        ga_recommendation: recommendation,
        updated_at: serverTimestamp()
      });

      if (incident) {
        // Create notification for the reporter
        await addDoc(collection(db, 'notifications'), {
          user_id: incident.reporter_id,
          title: 'GA Recommendation Received',
          message: `GA has provided a recommendation for your incident: ${incident.type}`,
          type: 'recommendation',
          related_id: id,
          read: false,
          created_at: serverTimestamp()
        });
      }
    } catch (err) {
      handleFirestoreError(err, OperationType.UPDATE, `incidents/${id}`);
    }
  };

  const updateGHQRecommendation = async (id: string, recommendation: string) => {
    try {
      const incident = incidents.find(i => i.id === id);
      await updateDoc(doc(db, 'incidents', id), { 
        ghq_recommendation: recommendation,
        updated_at: serverTimestamp()
      });

      if (incident) {
        // Create notification for the reporter
        await addDoc(collection(db, 'notifications'), {
          user_id: incident.reporter_id,
          title: 'GHQ Recommendation Received',
          message: `GHQ has provided a recommendation for your incident: ${incident.type}`,
          type: 'recommendation',
          related_id: id,
          read: false,
          created_at: serverTimestamp()
        });
      }
    } catch (err) {
      handleFirestoreError(err, OperationType.UPDATE, `incidents/${id}`);
    }
  };

  const markNotificationAsRead = async (id: string) => {
    try {
      await updateDoc(doc(db, 'notifications', id), { read: true });
    } catch (err) {
      handleFirestoreError(err, OperationType.UPDATE, `notifications/${id}`);
    }
  };

  const updateIncidentUnit = async (incidentId: string, academyId: string) => {
    if (!currentUser || currentUser.role !== 'HQ_ADMIN') return;
    const academy = academies.find(a => a.id === academyId);
    if (!academy) return;

    try {
      const docRef = doc(db, 'incidents', incidentId);
      await updateDoc(docRef, {
        academy_id: academyId,
        academy_name: academy.name,
        updated_at: serverTimestamp()
      });
      if (selectedIncident?.id === incidentId) {
        setSelectedIncident({
          ...selectedIncident,
          academy_id: academyId,
          academy_name: academy.name
        });
      }
    } catch (err) {
      handleFirestoreError(err, OperationType.UPDATE, `incidents/${incidentId}`);
    }
  };

  if (!authReady) return <div className="h-screen flex items-center justify-center font-sans">Loading...</div>;

  if (!currentUser) {
    return (
      <div className="min-h-screen bg-slate-50 flex flex-col items-center justify-center p-6 font-sans">
        <div className="w-full max-w-md bg-white rounded-3xl shadow-xl shadow-slate-200/50 p-8 text-center">
          <div className="w-24 h-24 bg-[#5A5A40] rounded-3xl flex items-center justify-center text-white mx-auto mb-6 overflow-hidden shadow-lg shadow-slate-200 relative group">
            <img 
              src="/logo.png" 
              alt="Gyalsung Logo" 
              className="w-full h-full object-contain"
              referrerPolicy="no-referrer"
              onError={(e) => {
                (e.target as HTMLImageElement).style.display = 'none';
                const fallback = e.currentTarget.parentElement?.querySelector('.fallback-icon');
                if (fallback) fallback.classList.remove('hidden');
              }}
            />
            <div className="fallback-icon hidden absolute inset-0 flex items-center justify-center">
              <Shield size={48} className="text-white/90" />
            </div>
          </div>
          <h1 className="text-2xl font-bold text-slate-900 mb-2">Gyalsung Safety Portal</h1>
          <p className="text-slate-500 mb-8">Please sign in to access the safety connect portal and report incidents.</p>
          <button 
            onClick={handleLogin}
            className="w-full py-4 bg-[#5A5A40] text-white rounded-2xl font-bold flex items-center justify-center gap-3 hover:bg-[#4A4A30] transition-all active:scale-95 shadow-lg shadow-slate-200"
          >
            <LogIn size={20} />
            Sign in with Google
          </button>
        </div>
      </div>
    );
  }

  const navItems = [
    { id: 'dashboard', label: currentUser?.role === 'STUDENT' ? 'Report' : 'Dashboard', icon: currentUser?.role === 'STUDENT' ? Plus : BarChart3, roles: ['HQ_ADMIN', 'ACADEMY_STAFF', 'STUDENT'] },
    { id: 'report', label: 'Report Incident', icon: Plus, roles: ['HQ_ADMIN', 'ACADEMY_STAFF', 'ERT'], isAction: true },
    { id: 'incidents', label: 'Incidents', icon: AlertTriangle, roles: ['HQ_ADMIN', 'ACADEMY_STAFF', 'ERT'] },
    { id: 'actions', label: 'Actions', icon: CheckSquare, roles: ['HQ_ADMIN', 'ACADEMY_STAFF', 'ERT'] },
    { id: 'inspections', label: 'Inspections', icon: FileText, roles: ['HQ_ADMIN', 'ACADEMY_STAFF'] },
    { id: 'knowledge', label: 'Knowledge Base', icon: BookOpen, roles: ['HQ_ADMIN', 'ACADEMY_STAFF', 'STUDENT'] },
    { id: 'settings', label: 'Settings', icon: Settings, roles: ['HQ_ADMIN', 'ACADEMY_STAFF', 'STUDENT', 'ERT'] },
  ];

  const filteredNav = navItems.filter(item => item.roles.includes(currentUser.role));

  return (
    <div className="min-h-screen bg-[#F8F9FA] font-sans text-slate-900 flex">
      {/* Sidebar */}
      <aside className={cn(
        "fixed inset-y-0 left-0 z-50 w-64 bg-white border-r border-black/5 transition-transform duration-300 lg:translate-x-0 lg:static",
        isSidebarOpen ? "translate-x-0" : "-translate-x-full"
      )}>
        <div className="p-6 flex items-center gap-3">
          <div className="w-12 h-12 bg-[#5A5A40] rounded-xl flex items-center justify-center text-white overflow-hidden shadow-sm relative">
            <img 
              src={academies.find(a => a.id === currentUser.academy_id)?.logo || "/logo.png"} 
              alt="Logo" 
              className="w-full h-full object-contain"
              referrerPolicy="no-referrer"
              onError={(e) => {
                (e.target as HTMLImageElement).style.display = 'none';
                const fallback = e.currentTarget.parentElement?.querySelector('.sidebar-fallback');
                if (fallback) fallback.classList.remove('hidden');
              }}
            />
            <div className="sidebar-fallback hidden absolute inset-0 flex items-center justify-center">
              <Shield size={24} className="text-white/90" />
            </div>
          </div>
          <div>
            <h1 className="font-bold text-lg leading-tight">Gyalsung</h1>
            <p className="text-xs text-slate-500 font-medium tracking-wide uppercase">Safety Connect</p>
          </div>
        </div>

        <nav className="mt-6 px-4 space-y-1">
          {filteredNav.map((item) => (
            <button
              key={item.id}
              onClick={() => { 
                if ((item as any).isAction) {
                  setShowReportModal(true);
                } else {
                  setActiveTab(item.id); 
                }
                setIsSidebarOpen(false); 
              }}
              className={cn(
                "w-full flex items-center gap-3 px-4 py-3 rounded-xl text-sm font-medium transition-all",
                activeTab === item.id && !(item as any).isAction
                  ? "bg-indigo-50 text-indigo-600" 
                  : (item as any).isAction 
                    ? "bg-indigo-600 text-white shadow-sm shadow-indigo-200 my-2"
                    : "text-slate-500 hover:bg-slate-50 hover:text-slate-900"
              )}
            >
              <item.icon size={20} />
              {item.label}
            </button>
          ))}
        </nav>

        <div className="absolute bottom-0 left-0 right-0 p-4 border-t border-black/5">
          <div className="flex items-center gap-3 p-3 bg-slate-50 rounded-2xl">
            <div className="w-10 h-10 bg-slate-200 rounded-full flex items-center justify-center text-slate-600">
              <UserIcon size={20} />
            </div>
            <div className="flex-1 min-w-0">
              <p className="text-sm font-semibold truncate">{currentUser.name}</p>
              <p className="text-xs text-slate-500 truncate">
                {currentUser.role === 'ACADEMY_STAFF' ? 'Unit Staff' : currentUser.role.replace('_', ' ')}
              </p>
            </div>
            <button 
              onClick={handleLogout}
              className="p-2 text-slate-400 hover:text-rose-600 transition-colors"
              title="Sign Out"
            >
              <LogOut size={18} />
            </button>
          </div>
        </div>
      </aside>

      {/* Main Content */}
      <main className="flex-1 flex flex-col min-w-0 overflow-hidden">
        {/* Header */}
        <header className="h-16 bg-white border-b border-black/5 flex items-center justify-between px-6 shrink-0">
          <div className="flex items-center gap-4">
            <button 
              onClick={() => setIsSidebarOpen(true)}
              className="lg:hidden p-2 -ml-2 text-slate-500"
            >
              <Menu size={24} />
            </button>
            <div className="flex items-center gap-3">
              {academies.find(a => a.id === currentUser.academy_id)?.logo && (
                <img 
                  src={academies.find(a => a.id === currentUser.academy_id)?.logo} 
                  alt="" 
                  className="w-8 h-8 rounded-lg object-cover lg:hidden"
                  referrerPolicy="no-referrer"
                />
              )}
              <h2 className="text-lg font-semibold capitalize">
                {activeTab === 'dashboard' && currentUser?.role === 'STUDENT' ? 'Report' : activeTab.replace('-', ' ')}
              </h2>
            </div>
          </div>
          
          <div className="flex items-center gap-4">
            <div className="hidden md:flex flex-col items-end mr-2">
              <div className="flex items-center gap-1.5">
                <span className="relative flex h-2 w-2">
                  <span className="animate-ping absolute inline-flex h-full w-full rounded-full opacity-75 bg-emerald-400"></span>
                  <span className="relative inline-flex rounded-full h-2 w-2 bg-emerald-500"></span>
                </span>
                <p className="text-[10px] font-bold text-slate-400 uppercase tracking-widest">
                  Live Sync
                </p>
              </div>
              <p className="text-[10px] text-slate-500">Updated {format(lastUpdated, 'HH:mm:ss')}</p>
            </div>
            <button 
              onClick={() => window.location.reload()}
              disabled={isSyncing}
              className={cn(
                "p-2 text-slate-500 hover:bg-slate-50 rounded-full transition-all duration-500",
                isSyncing ? "animate-spin text-indigo-600" : "active:rotate-180"
              )}
              title="Refresh Page"
            >
              <RefreshCw size={20} />
            </button>
            <button 
              onClick={() => setShowNotifications(!showNotifications)}
              className="p-2 text-slate-500 hover:bg-slate-50 rounded-full relative"
            >
              <Bell size={20} />
              {notifications.some(n => !n.read) && (
                <span className="absolute top-1.5 right-1.5 w-4 h-4 bg-rose-500 text-white text-[10px] font-bold flex items-center justify-center rounded-full border-2 border-white">
                  {notifications.filter(n => !n.read).length}
                </span>
              )}
            </button>
          </div>
        </header>

        {/* Scrollable Area */}
        <div className="flex-1 overflow-y-auto p-6">
          <AnimatePresence mode="wait">
            {activeTab === 'dashboard' && (
              <motion.div
                key="dashboard"
                initial={{ opacity: 0, y: 10 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -10 }}
                className="space-y-6"
              >
                {currentUser?.role === 'STUDENT' ? (
                  <div className="max-w-2xl mx-auto relative">
                    <Card className="p-8 relative overflow-hidden">
                      <div className="absolute inset-0 flex items-center justify-center opacity-[0.05] pointer-events-none select-none">
                        <img src="/logo.png" alt="" className="w-full max-w-md object-contain" referrerPolicy="no-referrer" />
                      </div>
                      <div className="relative z-10">
                        <div className="flex items-center gap-3 mb-6">
                        <div className="w-10 h-10 bg-rose-100 text-rose-600 rounded-xl flex items-center justify-center">
                          <AlertCircle size={24} />
                        </div>
                        <h3 className="text-xl font-bold text-slate-900">Report New Incident</h3>
                      </div>
                      <form onSubmit={handleReportIncident} className="space-y-6">
                        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                          <div className="space-y-2">
                            <label className="text-sm font-bold text-slate-700">Unit (Academy/GHQ)</label>
                            <select 
                              name="academy_id" 
                              required 
                              defaultValue={currentUser.academy_id}
                              className="w-full px-4 py-3 bg-slate-50 border border-black/5 rounded-xl text-sm outline-none focus:ring-2 focus:ring-indigo-500/20 transition-all"
                            >
                              {academies.map(a => (
                                <option key={a.id} value={a.id}>{a.name}</option>
                              ))}
                            </select>
                          </div>
                          <div className="space-y-2">
                            <label className="text-sm font-bold text-slate-700">Severity Level</label>
                            <select name="severity" required className="w-full px-4 py-3 bg-slate-50 border border-black/5 rounded-xl text-sm outline-none focus:ring-2 focus:ring-indigo-500/20 transition-all">
                              <option value="Low">Low</option>
                              <option value="Medium">Medium</option>
                              <option value="High">High</option>
                              <option value="Critical">Critical</option>
                            </select>
                          </div>
                        </div>

                        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                          <div className="space-y-2">
                            <label className="text-sm font-bold text-slate-700">Incident Type</label>
                            <select name="type" required className="w-full px-4 py-3 bg-slate-50 border border-black/5 rounded-xl text-sm outline-none focus:ring-2 focus:ring-indigo-500/20 transition-all">
                              <option value="Minor">Minor (Cut, Bruise, Sprain)</option>
                              <option value="Major">Major (Fracture, Fire, Spill)</option>
                              <option value="Emergency">Emergency (Serious Injury)</option>
                              <option value="Other">Other</option>
                            </select>
                          </div>
                          <div className="space-y-2">
                            <label className="text-sm font-bold text-slate-700">Specific Location</label>
                            <input name="location" required placeholder="e.g., Basketball Court" className="w-full px-4 py-3 bg-slate-50 border border-black/5 rounded-xl text-sm outline-none focus:ring-2 focus:ring-indigo-500/20 transition-all" />
                          </div>
                        </div>

                        <div className="space-y-2">
                          <label className="text-sm font-bold text-slate-700">Description</label>
                          <textarea name="description" required rows={3} placeholder="Describe exactly what happened..." className="w-full px-4 py-3 bg-slate-50 border border-black/5 rounded-xl text-sm outline-none focus:ring-2 focus:ring-indigo-500/20 transition-all resize-none" />
                        </div>

                        <div className="space-y-2">
                          <label className="text-sm font-bold text-slate-700">Immediate Action Taken</label>
                          <textarea name="immediate_action" rows={2} placeholder="What was done immediately?" className="w-full px-4 py-3 bg-slate-50 border border-black/5 rounded-xl text-sm outline-none focus:ring-2 focus:ring-indigo-500/20 transition-all resize-none" />
                        </div>

                        <div className="space-y-2">
                          <label className="text-sm font-bold text-slate-700">Photo (Optional)</label>
                          <div className="flex items-center gap-4">
                            <label className="flex-1 flex flex-col items-center justify-center border-2 border-dashed border-slate-200 rounded-2xl p-6 hover:border-indigo-300 hover:bg-indigo-50/30 transition-all cursor-pointer group">
                              {photoBase64 ? (
                                <div className="relative w-full h-32">
                                  <img src={photoBase64} alt="Preview" className="w-full h-full object-cover rounded-xl" />
                                  <button type="button" onClick={(e) => { e.preventDefault(); setPhotoBase64(null); }} className="absolute -top-2 -right-2 bg-rose-500 text-white p-1 rounded-full shadow-lg"><X size={14} /></button>
                                </div>
                              ) : (
                                <>
                                  <div className="w-10 h-10 bg-slate-100 text-slate-400 rounded-xl flex items-center justify-center group-hover:bg-indigo-100 group-hover:text-indigo-600 transition-all mb-2">
                                    <Camera size={20} />
                                  </div>
                                  <p className="text-xs font-bold text-slate-500 group-hover:text-indigo-600 transition-all">Click to upload photo</p>
                                  <input type="file" accept="image/*" className="hidden" onChange={handlePhotoUpload} />
                                </>
                              )}
                            </label>
                          </div>
                        </div>

                        <button 
                          type="submit" 
                          disabled={isSubmitting}
                          className="w-full py-4 bg-[#5A5A40] text-white rounded-2xl font-bold hover:bg-[#4A4A30] transition-all shadow-lg shadow-slate-200 disabled:opacity-50"
                        >
                          {isSubmitting ? 'Submitting...' : 'Submit Incident Report'}
                        </button>
                      </form>
                    </div>
                  </Card>
                </div>
                ) : (
                  <>
                    {/* Stats Grid */}
                    <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
                  <Card className="p-6">
                    <p className="text-sm font-medium text-slate-500">Total Incidents</p>
                    <div className="mt-2 flex items-end justify-between">
                      <h3 className="text-3xl font-bold">{stats?.total || 0}</h3>
                      <Badge variant="info">All Time</Badge>
                    </div>
                  </Card>
                  <Card className="p-6">
                    <p className="text-sm font-medium text-slate-500">Resolved</p>
                    <div className="mt-2 flex items-end justify-between">
                      <h3 className="text-3xl font-bold">{stats?.resolved || 0}</h3>
                      <Badge variant="success">
                        {stats?.total ? Math.round((stats.resolved / stats.total) * 100) : 0}% Rate
                      </Badge>
                    </div>
                  </Card>
                  <Card className="p-6">
                    <p className="text-sm font-medium text-slate-500">Active Actions</p>
                    <div className="mt-2 flex items-end justify-between">
                      <h3 className="text-3xl font-bold">{actions.filter(a => a.status === 'Pending').length}</h3>
                      <Badge variant="warning">Pending</Badge>
                    </div>
                  </Card>
                  <Card className="p-6">
                    <p className="text-sm font-medium text-slate-500">Inspections</p>
                    <div className="mt-2 flex items-end justify-between">
                      <h3 className="text-3xl font-bold">{inspections.length}</h3>
                      <Badge variant="default">Completed</Badge>
                    </div>
                  </Card>
                </div>

                {/* Charts */}
                <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
                  <Card className="p-6 lg:col-span-3">
                    <h4 className="font-semibold mb-6">Incidents by Unit</h4>
                    <div className="h-64">
                      <ResponsiveContainer width="100%" height="100%">
                        <BarChart data={stats?.byAcademy || []}>
                          <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#f1f5f9" />
                          <XAxis dataKey="name" axisLine={false} tickLine={false} tick={{ fontSize: 12, fill: '#64748b' }} />
                          <YAxis axisLine={false} tickLine={false} tick={{ fontSize: 12, fill: '#64748b' }} />
                          <Tooltip 
                            contentStyle={{ borderRadius: '12px', border: 'none', boxShadow: '0 10px 15px -3px rgb(0 0 0 / 0.1)' }}
                          />
                          <Bar dataKey="count" fill="#4f46e5" radius={[4, 4, 0, 0]} barSize={40} />
                        </BarChart>
                      </ResponsiveContainer>
                    </div>
                  </Card>
                </div>

                <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 mt-6">
                  <Card className="p-6">
                    <h4 className="font-semibold mb-6">Incident Type Distribution</h4>
                    <div className="h-64 flex items-center justify-center">
                      <ResponsiveContainer width="100%" height="100%">
                        <PieChart>
                          <Pie
                            data={stats?.byType || []}
                            cx="50%"
                            cy="50%"
                            innerRadius={60}
                            outerRadius={80}
                            paddingAngle={5}
                            dataKey="count"
                            nameKey="type"
                          >
                            {stats?.byType?.map((entry: any, index: number) => (
                              <Cell key={`cell-${index}`} fill={['#4f46e5', '#f59e0b', '#ef4444'][index % 3]} />
                            ))}
                          </Pie>
                          <Tooltip />
                        </PieChart>
                      </ResponsiveContainer>
                    </div>
                  </Card>
                </div>

                {/* Recent Incidents */}
                <Card>
                  <div className="p-6 border-b border-black/5 flex items-center justify-between">
                    <div className="flex items-center gap-3">
                      <h4 className="font-semibold">Recent Incidents</h4>
                      {selectedAcademy !== 'All Units' && (
                        <Badge variant="info" className="text-[10px]">Filtered: {selectedAcademy}</Badge>
                      )}
                    </div>
                    <button onClick={() => setActiveTab('incidents')} className="text-sm text-indigo-600 font-medium hover:underline">View All</button>
                  </div>
                  <div className="overflow-x-auto">
                    <table className="w-full text-left">
                      <thead>
                        <tr className="bg-slate-50 text-xs font-semibold text-slate-500 uppercase tracking-wider">
                          <th className="px-6 py-4">Incident</th>
                          <th className="px-6 py-4">Unit</th>
                          <th className="px-6 py-4">Reporter</th>
                          <th className="px-6 py-4">Type</th>
                          <th className="px-6 py-4">Status</th>
                          <th className="px-6 py-4">Date</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-black/5">
                        {incidents
                          .filter(inc => selectedAcademy === 'All Units' || inc.academy_name === selectedAcademy)
                          .slice(0, 10).map((incident) => (
                          <tr key={incident.id} className="hover:bg-slate-50 transition-colors">
                            <td className="px-6 py-4">
                              <p className="text-sm font-medium text-slate-900">{incident.location}</p>
                              <p className="text-xs text-slate-500 truncate max-w-[200px]">{incident.description}</p>
                            </td>
                            <td className="px-6 py-4 text-sm text-slate-600">
                              <button 
                                onClick={() => {
                                  setSelectedAcademy(incident.academy_name);
                                  setActiveTab('incidents');
                                }}
                                className="hover:text-indigo-600 hover:underline transition-colors"
                              >
                                {incident.academy_name || 'Unknown Unit'}
                              </button>
                            </td>
                            <td className="px-6 py-4">
                              <div className="flex items-center gap-2">
                                <div className="w-6 h-6 bg-slate-100 rounded-full flex items-center justify-center text-[10px] font-bold text-slate-600">
                                  {incident.reporter_name?.charAt(0) || '?'}
                                </div>
                                <span className="text-xs text-slate-600 font-medium">{incident.reporter_name || 'Unknown'}</span>
                              </div>
                            </td>
                            <td className="px-6 py-4">
                              <Badge variant={incident.type === 'Emergency' ? 'error' : incident.type === 'Major' ? 'warning' : 'info'}>
                                {incident.type}
                              </Badge>
                            </td>
                            <td className="px-6 py-4">
                              <span className={cn(
                                "inline-flex items-center gap-1.5 text-xs font-medium",
                                incident.status === 'Resolved' ? "text-emerald-600" : "text-amber-600"
                              )}>
                                <span className={cn("w-1.5 h-1.5 rounded-full", incident.status === 'Resolved' ? "bg-emerald-600" : "bg-amber-600")}></span>
                                {incident.status}
                              </span>
                            </td>
                            <td className="px-6 py-4 text-sm text-slate-500">
                              <div className="flex flex-col">
                                <span className="font-medium">{format(new Date(incident.updated_at), 'MMM d, HH:mm')}</span>
                                <span className="text-[10px] text-slate-400">Updated</span>
                              </div>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </Card>
              </>
            )}
          </motion.div>
        )}

            {activeTab === 'incidents' && (
              <motion.div
                key="incidents"
                initial={{ opacity: 0, x: 20 }}
                animate={{ opacity: 1, x: 0 }}
                exit={{ opacity: 0, x: -20 }}
                className="space-y-6"
              >
                <div className="flex flex-col sm:flex-row gap-4 items-center justify-between">
                  <div className="flex items-center gap-4">
                    <div className="flex items-center gap-2 bg-white border border-black/5 rounded-xl px-3 py-2 w-full sm:w-auto">
                      {selectedAcademy !== 'All Units' && academies.find(a => a.name === selectedAcademy)?.logo && (
                        <img 
                          src={academies.find(a => a.name === selectedAcademy)?.logo} 
                          alt="" 
                          className="w-5 h-5 rounded-full object-cover"
                          referrerPolicy="no-referrer"
                        />
                      )}
                      <MapPin size={18} className="text-slate-400" />
                      <select 
                        value={selectedAcademy}
                        onChange={(e) => setSelectedAcademy(e.target.value)}
                        className="bg-transparent text-sm font-medium outline-none border-none focus:ring-0"
                      >
                        <option value="All Units">All Units</option>
                        {academies.map(a => <option key={a.id} value={a.name}>{a.name}</option>)}
                      </select>
                    </div>
                    {selectedAcademy !== 'All Units' && (
                      <button 
                        onClick={() => setSelectedAcademy('All Units')}
                        className="text-xs text-indigo-600 font-bold hover:underline"
                      >
                        Clear Filter
                      </button>
                    )}
                  </div>
                  <div className="flex items-center gap-2 w-full sm:w-auto">
                    <button className="flex-1 sm:flex-none px-4 py-2 bg-white border border-black/5 rounded-xl text-sm font-medium hover:bg-slate-50">Filter</button>
                    <button className="flex-1 sm:flex-none px-4 py-2 bg-white border border-black/5 rounded-xl text-sm font-medium hover:bg-slate-50">Export</button>
                  </div>
                </div>

                <div className="grid grid-cols-1 gap-4">
                  {incidents
                    .filter(incident => selectedAcademy === 'All Units' || incident.academy_name === selectedAcademy)
                    .map((incident) => (
                    <Card key={incident.id} className="p-6">
                      <div className="flex flex-col md:flex-row gap-6">
                        <div className="flex-1">
                          <div className="flex items-start justify-between mb-2">
                            <div>
                              <div className="flex items-center gap-2 mb-1">
                                <Badge variant={incident.type === 'Emergency' ? 'error' : incident.type === 'Major' ? 'warning' : 'info'}>
                                  {incident.type}
                                </Badge>
                                <button 
                                  onClick={() => setSelectedAcademy(incident.academy_name)}
                                  className="flex items-center gap-1.5 text-xs text-slate-400 font-medium uppercase tracking-wider hover:text-indigo-600 hover:underline transition-colors"
                                >
                                  {academies.find(a => a.name === incident.academy_name)?.logo && (
                                    <img 
                                      src={academies.find(a => a.name === incident.academy_name)?.logo} 
                                      alt="" 
                                      className="w-4 h-4 rounded-full object-cover"
                                      referrerPolicy="no-referrer"
                                    />
                                  )}
                                  {incident.academy_name}
                                </button>
                              </div>
                              <h4 className="text-lg font-bold text-slate-900">{incident.location}</h4>
                            </div>
                            <div className="text-right">
                              <p className="text-xs text-slate-500 flex items-center justify-end gap-1">
                                <Clock size={12} />
                                {format(new Date(incident.updated_at), 'MMM d, HH:mm')}
                              </p>
                              <p className="text-[10px] text-slate-400 font-bold uppercase tracking-tighter mt-0.5">Last Updated</p>
                              <p className="text-xs font-medium text-slate-400 mt-1">Reported by: {incident.reporter_name}</p>
                            </div>
                          </div>
                          <p className="text-sm text-slate-600 leading-relaxed mb-4">{incident.description}</p>
                          
                          {incident.photo && (
                            <div className="mb-4">
                              <img 
                                src={incident.photo} 
                                alt="Incident" 
                                className="w-full max-h-64 object-cover rounded-2xl border border-black/5"
                                referrerPolicy="no-referrer"
                              />
                            </div>
                          )}
                          
                          <div className="bg-slate-50 rounded-xl p-4 border border-black/5 mb-4">
                            <p className="text-xs font-bold text-slate-500 uppercase mb-2">Immediate Action Taken</p>
                            <p className="text-sm text-slate-700 italic mb-4">"{incident.immediate_action || 'None recorded'}"</p>
                            
                            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                              <div>
                                <p className="text-xs font-bold text-slate-500 uppercase mb-1">GA Recommendation</p>
                                {(currentUser.role === 'ACADEMY_STAFF' && currentUser.academy_id === incident.academy_id) || currentUser.role === 'HQ_ADMIN' ? (
                                  <textarea
                                    defaultValue={incident.ga_recommendation || ''}
                                    onBlur={(e) => updateGARecommendation(incident.id, e.target.value)}
                                    placeholder="Add GA recommendation..."
                                    className="w-full px-3 py-2 bg-white border border-black/5 rounded-lg text-sm outline-none focus:ring-2 focus:ring-indigo-500/20 transition-all resize-none"
                                    rows={2}
                                  />
                                ) : (
                                  <p className="text-sm text-slate-700">{incident.ga_recommendation || 'No recommendation provided by GA.'}</p>
                                )}
                              </div>
                              <div>
                                <p className="text-xs font-bold text-slate-500 uppercase mb-1">GHQ Recommendation</p>
                                {currentUser.role === 'HQ_ADMIN' ? (
                                  <textarea
                                    defaultValue={incident.ghq_recommendation || ''}
                                    onBlur={(e) => updateGHQRecommendation(incident.id, e.target.value)}
                                    placeholder="Add GHQ recommendation..."
                                    className="w-full px-3 py-2 bg-white border border-black/5 rounded-lg text-sm outline-none focus:ring-2 focus:ring-indigo-500/20 transition-all resize-none"
                                    rows={2}
                                  />
                                ) : (
                                  <p className="text-sm text-slate-700">{incident.ghq_recommendation || 'Pending GHQ review.'}</p>
                                )}
                              </div>
                            </div>
                          </div>
                        </div>

                        <div className="md:w-64 flex flex-col justify-between gap-4">
                          <div>
                            <p className="text-xs font-bold text-slate-500 uppercase mb-2">Status</p>
                            <select 
                              value={incident.status}
                              onChange={(e) => updateIncidentStatus(incident.id, e.target.value)}
                              className={cn(
                                "w-full px-3 py-2 rounded-xl text-sm font-semibold outline-none border border-black/5",
                                incident.status === 'Resolved' ? "bg-emerald-50 text-emerald-700" : "bg-amber-50 text-amber-700"
                              )}
                            >
                              <option value="Open">Open</option>
                              <option value="In Progress">In Progress</option>
                              <option value="Resolved">Resolved</option>
                              <option value="Closed">Closed</option>
                            </select>
                          </div>
                          
                          <div className="space-y-2">
                            <button className="w-full py-2 bg-indigo-600 text-white rounded-xl text-sm font-medium hover:bg-indigo-700 transition-all">
                              Assign Action
                            </button>
                            <button 
                              onClick={() => {
                                setSelectedIncident(incident);
                                setShowDetailModal(true);
                              }}
                              className="w-full py-2 bg-white border border-black/5 text-slate-700 rounded-xl text-sm font-medium hover:bg-slate-50 transition-all"
                            >
                              View Details
                            </button>
                          </div>
                        </div>
                      </div>
                    </Card>
                  ))}
                </div>
              </motion.div>
            )}

            {activeTab === 'actions' && (
              <motion.div
                key="actions"
                initial={{ opacity: 0, scale: 0.95 }}
                animate={{ opacity: 1, scale: 1 }}
                exit={{ opacity: 0, scale: 0.95 }}
                className="space-y-6"
              >
                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
                  {actions.map((action) => (
                    <Card key={action.id} className="p-6 flex flex-col">
                      <div className="flex items-center justify-between mb-4">
                        <Badge variant={action.status === 'Completed' ? 'success' : 'warning'}>
                          {action.status}
                        </Badge>
                        <span className="text-xs text-slate-400 font-medium">Due: {format(new Date(action.due_date), 'MMM d')}</span>
                      </div>
                      <h5 className="font-semibold text-slate-900 mb-2">{action.description}</h5>
                      <div className="mt-auto pt-4 border-t border-black/5 flex items-center justify-between">
                        <div className="flex items-center gap-2">
                          <div className="w-6 h-6 bg-slate-100 rounded-full flex items-center justify-center text-[10px] font-bold text-slate-600">
                            {action.assignee_name.charAt(0)}
                          </div>
                          <span className="text-xs text-slate-500">{action.assignee_name}</span>
                        </div>
                        {action.status !== 'Completed' && (
                          <button className="text-xs font-bold text-indigo-600 hover:underline">Complete</button>
                        )}
                      </div>
                    </Card>
                  ))}
                  <button className="border-2 border-dashed border-slate-200 rounded-2xl p-6 flex flex-col items-center justify-center text-slate-400 hover:border-indigo-300 hover:text-indigo-400 transition-all">
                    <Plus size={32} className="mb-2" />
                    <span className="font-medium">Assign New Action</span>
                  </button>
                </div>
              </motion.div>
            )}

            {activeTab === 'inspections' && (
              <motion.div
                key="inspections"
                initial={{ opacity: 0, y: 20 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -20 }}
                className="space-y-6"
              >
                <div className="grid grid-cols-1 gap-4">
                  {inspections.map((insp) => (
                    <Card key={insp.id} className="p-6 flex items-center justify-between">
                      <div className="flex items-center gap-4">
                        <div className="w-12 h-12 bg-emerald-50 text-emerald-600 rounded-2xl flex items-center justify-center">
                          <CheckSquare size={24} />
                        </div>
                        <div>
                          <h5 className="font-bold text-slate-900">{insp.title}</h5>
                          <p className="text-xs text-slate-500 font-medium uppercase">{insp.academy_name} • {insp.inspector_name}</p>
                        </div>
                      </div>
                      <div className="flex items-center gap-6">
                        <div className="text-right hidden sm:block">
                          <p className="text-sm font-semibold text-emerald-600">Pass</p>
                          <p className="text-xs text-slate-400">{format(new Date(insp.created_at), 'MMM d, yyyy')}</p>
                        </div>
                        <button className="p-2 text-slate-400 hover:text-indigo-600">
                          <ChevronRight size={20} />
                        </button>
                      </div>
                    </Card>
                  ))}
                </div>
              </motion.div>
            )}

            {activeTab === 'knowledge' && (
              <motion.div
                key="knowledge"
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
                className="grid grid-cols-1 md:grid-cols-2 gap-6"
              >
                {knowledge.map((item) => (
                  <Card key={item.id} className="p-6">
                    <div className="flex items-center gap-2 mb-4">
                      <Badge variant="info">{item.incident_type}</Badge>
                      <span className="text-xs text-slate-400">{format(new Date(item.created_at), 'MMM d, yyyy')}</span>
                    </div>
                    <h5 className="text-lg font-bold text-slate-900 mb-3">{item.title}</h5>
                    <p className="text-sm text-slate-600 leading-relaxed mb-4">{item.content}</p>
                    <button className="text-sm font-bold text-indigo-600 flex items-center gap-1 hover:gap-2 transition-all">
                      Read Full SOP <ChevronRight size={16} />
                    </button>
                  </Card>
                ))}
              </motion.div>
            )}

            {activeTab === 'settings' && (
              <motion.div
                key="settings"
                initial={{ opacity: 0, y: 20 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -20 }}
                className="max-w-2xl mx-auto"
              >
                <Card className="p-8">
                  <div className="flex items-center gap-4 mb-8">
                    <div className="w-16 h-16 bg-indigo-100 text-indigo-600 rounded-2xl flex items-center justify-center">
                      <UserIcon size={32} />
                    </div>
                    <div>
                      <h3 className="text-xl font-bold text-slate-900">Profile Settings</h3>
                      <p className="text-sm text-slate-500">Manage your personal information and unit assignment</p>
                    </div>
                  </div>

                  <form onSubmit={updateProfile} className="space-y-6">
                    <div className="space-y-2">
                      <label className="text-sm font-bold text-slate-700">Full Name</label>
                      <input 
                        name="name" 
                        defaultValue={currentUser.name}
                        required
                        className="w-full px-4 py-3 bg-slate-50 border border-black/5 rounded-xl text-sm outline-none focus:ring-2 focus:ring-indigo-500/20 transition-all"
                      />
                    </div>

                    <div className="space-y-2">
                      <label className="text-sm font-bold text-slate-700">Email Address</label>
                      <input 
                        disabled
                        value={currentUser.email}
                        className="w-full px-4 py-3 bg-slate-100 border border-black/5 rounded-xl text-sm text-slate-500 cursor-not-allowed"
                      />
                    </div>

                    <div className="space-y-2">
                      <label className="text-sm font-bold text-slate-700">Assigned Unit (Academy/GHQ)</label>
                      <select 
                        name="academy_id" 
                        defaultValue={currentUser.academy_id}
                        required
                        className="w-full px-4 py-3 bg-slate-50 border border-black/5 rounded-xl text-sm outline-none focus:ring-2 focus:ring-indigo-500/20 transition-all"
                      >
                        {academies.map(a => (
                          <option key={a.id} value={a.id}>{a.name}</option>
                        ))}
                      </select>
                      <p className="text-[10px] text-slate-400 mt-1 uppercase tracking-wider font-bold">
                        This unit will be automatically used for your incident reports
                      </p>
                    </div>

                    <div className="pt-4">
                      <button 
                        type="submit"
                        disabled={isSubmitting}
                        className="w-full py-4 bg-indigo-600 text-white rounded-2xl font-bold hover:bg-indigo-700 transition-all shadow-lg shadow-indigo-200 disabled:opacity-50"
                      >
                        {isSubmitting ? 'Saving Changes...' : 'Save Profile Settings'}
                      </button>
                    </div>
                  </form>
                </Card>
              </motion.div>
            )}
          </AnimatePresence>
        </div>
      </main>

      {/* Incident Detail Modal */}
      <AnimatePresence>
        {showDetailModal && selectedIncident && (
          <div className="fixed inset-0 z-[100] flex items-center justify-center p-4">
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              onClick={() => setShowDetailModal(false)}
              className="absolute inset-0 bg-slate-900/40 backdrop-blur-sm"
            />
            <motion.div
              initial={{ opacity: 0, scale: 0.9, y: 20 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.9, y: 20 }}
              onClick={(e) => e.stopPropagation()}
              className="relative w-full max-w-2xl bg-white rounded-3xl shadow-2xl overflow-hidden"
            >
              <div className="p-6 border-b border-black/5 flex items-center justify-between bg-slate-50">
                <div className="flex items-center gap-3">
                  <button onClick={() => setShowDetailModal(false)} className="p-2 -ml-2 text-slate-400 hover:bg-white rounded-full transition-colors">
                    <ArrowLeft size={24} />
                  </button>
                  <div className="w-10 h-10 bg-indigo-100 text-indigo-600 rounded-xl flex items-center justify-center">
                    <AlertCircle size={24} />
                  </div>
                  <h3 className="text-xl font-bold text-slate-900">Incident Details</h3>
                </div>
                <button onClick={() => setShowDetailModal(false)} className="p-2 text-slate-400 hover:bg-white rounded-full transition-colors">
                  <X size={24} />
                </button>
              </div>

              <div className="p-8 space-y-6 overflow-y-auto max-h-[75vh]">
                <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                  <div>
                    <h4 className="text-xs font-bold text-slate-400 uppercase tracking-wider mb-2">Reporter</h4>
                    <div className="flex items-center gap-3 p-3 bg-slate-50 rounded-xl border border-black/5">
                      <div className="w-10 h-10 bg-white rounded-full flex items-center justify-center text-sm font-bold text-slate-600 border border-slate-200">
                        {selectedIncident.reporter_name?.charAt(0) || '?'}
                      </div>
                      <div>
                        <p className="text-sm font-bold text-slate-900">{selectedIncident.reporter_name || 'Unknown'}</p>
                        {currentUser?.role === 'HQ_ADMIN' && (selectedIncident.academy_name === 'Unknown Unit' || !selectedIncident.academy_id) ? (
                          <select 
                            onChange={(e) => updateIncidentUnit(selectedIncident.id, e.target.value)}
                            className="text-xs text-indigo-600 font-bold bg-transparent border-none p-0 focus:ring-0 cursor-pointer hover:underline"
                          >
                            <option value="">Re-assign Unit...</option>
                            {academies.map(a => (
                              <option key={a.id} value={a.id}>{a.name}</option>
                            ))}
                          </select>
                        ) : (
                          <p className="text-xs text-slate-500">{selectedIncident.academy_name || 'Unknown Unit'}</p>
                        )}
                      </div>
                    </div>
                  </div>
                  <div>
                    <h4 className="text-xs font-bold text-slate-400 uppercase tracking-wider mb-2">Status & Severity</h4>
                    <div className="flex flex-wrap gap-2">
                      <Badge variant={selectedIncident.status === 'Open' ? 'error' : selectedIncident.status === 'In Progress' ? 'warning' : 'success'}>
                        {selectedIncident.status}
                      </Badge>
                      <Badge variant={selectedIncident.severity === 'Critical' ? 'error' : selectedIncident.severity === 'High' ? 'warning' : 'info'}>
                        {selectedIncident.severity}
                      </Badge>
                      <Badge variant="info">{selectedIncident.type}</Badge>
                    </div>
                  </div>
                </div>

                <div className="space-y-4">
                  <div>
                    <h4 className="text-xs font-bold text-slate-400 uppercase tracking-wider mb-1">Location</h4>
                    <p className="text-slate-900 font-medium">{selectedIncident.location}</p>
                  </div>
                  <div>
                    <h4 className="text-xs font-bold text-slate-400 uppercase tracking-wider mb-1">Description</h4>
                    <p className="text-sm text-slate-600 leading-relaxed">{selectedIncident.description}</p>
                  </div>
                  {selectedIncident.photo && (
                    <div>
                      <h4 className="text-xs font-bold text-slate-400 uppercase tracking-wider mb-2">Photo Evidence</h4>
                      <img 
                        src={selectedIncident.photo} 
                        alt="Incident" 
                        className="w-full max-h-64 object-cover rounded-2xl border border-black/5"
                        referrerPolicy="no-referrer"
                      />
                    </div>
                  )}
                </div>

                <div className="bg-slate-50 rounded-2xl p-6 border border-black/5 space-y-4">
                  <div>
                    <h4 className="text-xs font-bold text-slate-500 uppercase mb-1">Immediate Action Taken</h4>
                    <p className="text-sm text-slate-700 italic">"{selectedIncident.immediate_action || 'None recorded'}"</p>
                  </div>
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4 pt-4 border-t border-slate-200">
                    <div>
                      <h4 className="text-xs font-bold text-slate-500 uppercase mb-1">GA Recommendation</h4>
                      <p className="text-sm text-slate-700">{selectedIncident.ga_recommendation || 'No recommendation provided.'}</p>
                    </div>
                    <div>
                      <h4 className="text-xs font-bold text-slate-500 uppercase mb-1">GHQ Recommendation</h4>
                      <p className="text-sm text-slate-700">{selectedIncident.ghq_recommendation || 'Pending GHQ review.'}</p>
                    </div>
                  </div>
                </div>
              </div>

              <div className="p-6 border-t border-black/5 bg-slate-50 flex justify-end">
                <button 
                  onClick={() => setShowDetailModal(false)}
                  className="px-6 py-2 bg-slate-900 text-white rounded-xl font-bold hover:bg-slate-800 transition-all"
                >
                  Close Details
                </button>
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>

      {/* Report Modal */}
      {/* Sync Toast */}
      <AnimatePresence>
        {showSyncToast && (
          <motion.div
            initial={{ opacity: 0, y: 50, x: '-50%' }}
            animate={{ opacity: 1, y: 0, x: '-50%' }}
            exit={{ opacity: 0, y: 20, x: '-50%' }}
            className="fixed bottom-8 left-1/2 z-[200] bg-slate-900 text-white px-6 py-3 rounded-2xl shadow-2xl flex items-center gap-3 border border-white/10"
          >
            <div className="w-2 h-2 bg-emerald-500 rounded-full animate-pulse"></div>
            <p className="text-sm font-bold tracking-tight">Real-time update received</p>
          </motion.div>
        )}
      </AnimatePresence>

      <AnimatePresence>
        {showReportModal && (
          <div className="fixed inset-0 z-[100] flex items-center justify-center p-4">
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              onClick={() => setShowReportModal(false)}
              className="absolute inset-0 bg-slate-900/40 backdrop-blur-sm"
            />
            <motion.div
              initial={{ opacity: 0, scale: 0.9, y: 20 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.9, y: 20 }}
              onClick={(e) => e.stopPropagation()}
              className="relative w-full max-w-2xl bg-white rounded-3xl shadow-2xl overflow-hidden"
            >
              <div className="relative z-10">
                <div className="p-6 border-b border-black/5 flex items-center justify-between bg-slate-50">
                  <div className="flex items-center gap-3">
                    <button onClick={() => setShowReportModal(false)} className="p-2 -ml-2 text-slate-400 hover:bg-white rounded-full transition-colors">
                      <ArrowLeft size={24} />
                    </button>
                    <div className="w-10 h-10 bg-rose-100 text-rose-600 rounded-xl flex items-center justify-center">
                      <AlertCircle size={24} />
                    </div>
                    <h3 className="text-xl font-bold text-slate-900">Report New Incident</h3>
                  </div>
                  <button onClick={() => setShowReportModal(false)} className="p-2 text-slate-400 hover:bg-white rounded-full transition-colors">
                    <X size={24} />
                  </button>
                </div>

                <form onSubmit={handleReportIncident} className="flex flex-col max-h-[85vh]">
                  <div className="p-8 space-y-6 overflow-y-auto flex-1">
                    <div className="absolute inset-0 flex items-center justify-center opacity-[0.05] pointer-events-none select-none">
                      <img src="/logo.png" alt="" className="w-full max-w-md object-contain" referrerPolicy="no-referrer" />
                    </div>
                    <div className="relative z-20">
                      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                    <div className="space-y-2">
                      <label className="text-sm font-bold text-slate-700">Unit (Academy/GHQ)</label>
                      <select 
                        name="academy_id" 
                        required 
                        defaultValue={currentUser.academy_id}
                        className="w-full px-4 py-3 bg-slate-50 border border-black/5 rounded-xl text-sm outline-none focus:ring-2 focus:ring-indigo-500/20 transition-all"
                      >
                        {academies.map(a => (
                          <option key={a.id} value={a.id}>{a.name}</option>
                        ))}
                      </select>
                    </div>
                    <div className="space-y-2">
                      <label className="text-sm font-bold text-slate-700">Severity Level</label>
                      <select name="severity" required className="w-full px-4 py-3 bg-slate-50 border border-black/5 rounded-xl text-sm outline-none focus:ring-2 focus:ring-indigo-500/20 transition-all">
                        <option value="Low">Low</option>
                        <option value="Medium">Medium</option>
                        <option value="High">High</option>
                        <option value="Critical">Critical</option>
                      </select>
                    </div>
                  </div>

                  <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                    <div className="space-y-2">
                      <label className="text-sm font-bold text-slate-700">Incident Type</label>
                      <div className="space-y-2">
                        <select 
                          name="type" 
                          required 
                          onChange={(e) => {
                            const customInput = document.getElementById('custom_type_container');
                            if (e.target.value === 'Other') {
                              customInput?.classList.remove('hidden');
                            } else {
                              customInput?.classList.add('hidden');
                            }
                          }}
                          className="w-full px-4 py-3 bg-slate-50 border border-black/5 rounded-xl text-sm outline-none focus:ring-2 focus:ring-indigo-500/20 transition-all"
                        >
                          <option value="Minor">Minor (Cut, Bruise, Sprain)</option>
                          <option value="Major">Major (Fracture, Fire, Spill)</option>
                          <option value="Emergency">Emergency (Serious Injury)</option>
                          <option value="Other">Other (Type below)</option>
                        </select>
                        <div id="custom_type_container" className="hidden">
                          <input 
                            name="custom_type" 
                            placeholder="Enter custom incident type..."
                            className="w-full px-4 py-3 bg-slate-50 border border-black/5 rounded-xl text-sm outline-none focus:ring-2 focus:ring-indigo-500/20 transition-all"
                          />
                        </div>
                      </div>
                    </div>
                    <div className="space-y-2">
                      <label className="text-sm font-bold text-slate-700">Specific Location</label>
                      <input 
                        name="location" 
                        required 
                        placeholder="e.g., Basketball Court, Block B Kitchen"
                        className="w-full px-4 py-3 bg-slate-50 border border-black/5 rounded-xl text-sm outline-none focus:ring-2 focus:ring-indigo-500/20 transition-all"
                      />
                    </div>
                  </div>

                  <div className="space-y-2">
                    <label className="text-sm font-bold text-slate-700">Description of Incident</label>
                    <textarea 
                      name="description" 
                      required 
                      rows={3}
                      placeholder="Describe exactly what happened..."
                      className="w-full px-4 py-3 bg-slate-50 border border-black/5 rounded-xl text-sm outline-none focus:ring-2 focus:ring-indigo-500/20 transition-all resize-none"
                    />
                  </div>

                  <div className="space-y-2">
                    <label className="text-sm font-bold text-slate-700">Immediate Action Taken</label>
                    <textarea 
                      name="immediate_action" 
                      rows={2}
                      placeholder="What was done immediately after the incident?"
                      className="w-full px-4 py-3 bg-slate-50 border border-black/5 rounded-xl text-sm outline-none focus:ring-2 focus:ring-indigo-500/20 transition-all resize-none"
                    />
                  </div>

                  <div className="space-y-2">
                    <label className="text-sm font-bold text-slate-700">GA Recommendation (Preventive Measures)</label>
                    <textarea 
                      name="ga_recommendation" 
                      rows={2}
                      placeholder="What preventive measures do you recommend to avoid recurrence?"
                      className="w-full px-4 py-3 bg-slate-50 border border-black/5 rounded-xl text-sm outline-none focus:ring-2 focus:ring-indigo-500/20 transition-all resize-none"
                    />
                  </div>

                  <div className="space-y-2">
                    <label className="text-sm font-bold text-slate-700">Incident Photo (Optional)</label>
                    <div className="flex items-center gap-4">
                      <label className="flex-1 flex flex-col items-center justify-center border-2 border-dashed border-slate-200 rounded-2xl p-6 hover:border-indigo-300 hover:bg-indigo-50/30 transition-all cursor-pointer group">
                        {photoBase64 ? (
                          <div className="relative w-full h-32">
                            <img src={photoBase64} alt="Preview" className="w-full h-full object-cover rounded-xl" />
                            <button 
                              type="button"
                              onClick={(e) => { e.preventDefault(); setPhotoBase64(null); }}
                              className="absolute -top-2 -right-2 bg-rose-500 text-white p-1 rounded-full shadow-lg"
                            >
                              <X size={14} />
                            </button>
                          </div>
                        ) : (
                          <>
                            <div className="w-12 h-12 bg-slate-100 rounded-full flex items-center justify-center text-slate-400 group-hover:text-indigo-500 group-hover:bg-indigo-100 transition-all mb-2">
                              <Camera size={24} />
                            </div>
                            <span className="text-xs font-bold text-slate-500 group-hover:text-indigo-600">Click to upload photo</span>
                            <span className="text-[10px] text-slate-400 mt-1">Supports JPG, PNG</span>
                          </>
                        )}
                        <input type="file" accept="image/*" className="hidden" onChange={handlePhotoUpload} />
                      </label>
                    </div>
                  </div>
                  </div>
                </div>

                <div className="p-6 border-t border-black/5 bg-slate-50 flex gap-4">
                  <button 
                    type="button"
                    onClick={() => setShowReportModal(false)}
                    className="flex-1 py-3 bg-white border border-slate-200 text-slate-700 rounded-xl font-bold hover:bg-slate-50 transition-all"
                  >
                    Cancel
                  </button>
                  <button 
                    type="submit"
                    disabled={isSubmitting}
                    className="flex-1 py-3 bg-indigo-600 text-white rounded-xl font-bold hover:bg-indigo-700 transition-all shadow-lg shadow-indigo-200 disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2"
                  >
                    {isSubmitting ? (
                      <>
                        <div className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                        Submitting...
                      </>
                    ) : (
                      'Submit Report'
                    )}
                  </button>
                </div>
              </form>
            </div>
          </motion.div>
          </div>
        )}

        {/* Notifications Modal */}
        {showNotifications && (
          <div className="fixed inset-0 z-[100] flex items-start justify-end p-4 md:p-6 bg-black/20 backdrop-blur-sm">
            <motion.div 
              initial={{ opacity: 0, y: -20, scale: 0.95 }}
              animate={{ opacity: 1, y: 0, scale: 1 }}
              className="w-full max-w-md bg-white rounded-3xl shadow-2xl overflow-hidden border border-black/5"
            >
              <div className="p-6 border-b border-black/5 flex items-center justify-between bg-indigo-600 text-white">
                <div className="flex items-center gap-3">
                  <button onClick={() => setShowNotifications(false)} className="p-2 -ml-2 hover:bg-white/20 rounded-xl transition-all">
                    <ArrowLeft size={20} />
                  </button>
                  <div className="p-2 bg-white/20 rounded-xl">
                    <Bell size={20} />
                  </div>
                  <h3 className="text-xl font-bold">Notifications</h3>
                </div>
                <button 
                  onClick={() => setShowNotifications(false)}
                  className="p-2 hover:bg-white/20 rounded-xl transition-all"
                >
                  <X size={20} />
                </button>
              </div>

              <div className="max-h-[70vh] overflow-y-auto p-4 space-y-3">
                {notifications.length === 0 ? (
                  <div className="py-12 text-center">
                    <div className="w-16 h-16 bg-slate-50 rounded-full flex items-center justify-center text-slate-300 mx-auto mb-4">
                      <Bell size={32} />
                    </div>
                    <p className="text-slate-500 font-medium">No notifications yet</p>
                  </div>
                ) : (
                  notifications.map((notification) => (
                    <div 
                      key={notification.id}
                      className={cn(
                        "p-4 rounded-2xl border transition-all cursor-pointer group relative",
                        notification.read 
                          ? "bg-white border-slate-100 opacity-75" 
                          : "bg-indigo-50/50 border-indigo-100 ring-1 ring-indigo-500/10"
                      )}
                      onClick={() => {
                        if (!notification.read) markNotificationAsRead(notification.id);
                        const incident = incidents.find(i => i.id === notification.related_id);
                        if (incident) {
                          setSelectedIncident(incident);
                          setShowDetailModal(true);
                          setShowNotifications(false);
                        }
                      }}
                    >
                      <div className="flex gap-4">
                        <div className={cn(
                          "w-10 h-10 rounded-xl flex items-center justify-center shrink-0",
                          notification.type === 'recommendation' ? "bg-amber-100 text-amber-600" : "bg-indigo-100 text-indigo-600"
                        )}>
                          {notification.type === 'recommendation' ? <ShieldAlert size={20} /> : <Bell size={20} />}
                        </div>
                        <div className="flex-1 min-w-0">
                          <div className="flex items-start justify-between gap-2 mb-1">
                            <h4 className="font-bold text-slate-900 truncate">{notification.title}</h4>
                            <span className="text-[10px] font-medium text-slate-400 whitespace-nowrap mt-1">
                              {format(new Date(notification.created_at), 'MMM d, h:mm a')}
                            </span>
                          </div>
                          <p className="text-sm text-slate-600 line-clamp-2 leading-relaxed">
                            {notification.message}
                          </p>
                        </div>
                      </div>
                      {!notification.read && (
                        <div className="absolute top-4 right-4 w-2 h-2 bg-indigo-600 rounded-full"></div>
                      )}
                    </div>
                  ))
                )}
              </div>

              {notifications.some(n => !n.read) && (
                <div className="p-4 border-t border-black/5 bg-slate-50">
                  <button 
                    onClick={async () => {
                      const unread = notifications.filter(n => !n.read);
                      for (const n of unread) {
                        await markNotificationAsRead(n.id);
                      }
                    }}
                    className="w-full py-3 text-sm font-bold text-indigo-600 hover:bg-indigo-100/50 rounded-xl transition-all"
                  >
                    Mark all as read
                  </button>
                </div>
              )}
            </motion.div>
          </div>
        )}
      </AnimatePresence>
    </div>
  );
}
