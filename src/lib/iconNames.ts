// Curated Lucide icon catalog for slides. Kept as a plain string list (no React)
// so both the client catalog (icons.tsx) and the server-side AI prompt can import
// it. Names are the exact PascalCase lucide-react export names.
//
// Grouped only for readability; consumers treat it as one flat list.
export const ICON_GROUPS: { label: string; names: string[] }[] = [
  {
    label: 'Trends & data',
    names: [
      'TrendingUp', 'TrendingDown', 'Activity', 'BarChart3', 'LineChart', 'PieChart',
      'AreaChart', 'Gauge', 'Target', 'Percent', 'Scale', 'SlidersHorizontal',
    ],
  },
  {
    label: 'Business & finance',
    names: [
      'DollarSign', 'CircleDollarSign', 'Banknote', 'CreditCard', 'Wallet', 'Coins',
      'PiggyBank', 'Briefcase', 'Building2', 'Landmark', 'Handshake', 'ShoppingCart',
      'Package', 'Truck', 'Factory', 'Receipt',
    ],
  },
  {
    label: 'Strategy & ideas',
    names: [
      'Target', 'Rocket', 'Lightbulb', 'Brain', 'Sparkles', 'Wand2', 'Compass',
      'Map', 'MapPin', 'Flag', 'Milestone', 'Route', 'Puzzle', 'Workflow', 'GitBranch',
    ],
  },
  {
    label: 'Status & quality',
    names: [
      'CheckCircle2', 'XCircle', 'AlertTriangle', 'AlertCircle', 'Info', 'BadgeCheck',
      'ShieldCheck', 'Shield', 'Award', 'Trophy', 'Star', 'ThumbsUp', 'Flame', 'Heart',
    ],
  },
  {
    label: 'People & org',
    names: [
      'User', 'Users', 'UserCheck', 'UserPlus', 'Contact', 'Network', 'Globe', 'Globe2',
      'GraduationCap', 'Building',
    ],
  },
  {
    label: 'Tech & data',
    names: [
      'Database', 'Server', 'Cloud', 'Cpu', 'Code2', 'Terminal', 'Smartphone', 'Monitor',
      'Laptop', 'Wifi', 'Plug', 'Battery', 'Lock', 'Unlock', 'Key', 'Settings', 'Cog',
      'Wrench', 'Filter', 'Search', 'Layers', 'Box',
    ],
  },
  {
    label: 'Time & docs',
    names: [
      'Calendar', 'Clock', 'Timer', 'Hourglass', 'FileText', 'File', 'Folder',
      'Clipboard', 'ClipboardCheck', 'BookOpen', 'Book', 'Bell', 'Mail', 'MessageSquare',
      'Phone', 'Send', 'Share2', 'Link', 'Eye',
    ],
  },
  {
    label: 'Arrows & nature',
    names: [
      'ArrowUpRight', 'ArrowDownRight', 'ArrowRight', 'ArrowUp', 'ArrowDown',
      'ChevronRight', 'Plus', 'Minus', 'Check', 'X', 'RefreshCw', 'Repeat', 'Zap',
      'Leaf', 'TreePine', 'Sun', 'Moon', 'Droplet', 'Recycle', 'Anchor', 'Plane', 'Home',
    ],
  },
]

/** Flat, de-duplicated list of every catalog icon name. */
export const ICON_NAMES: string[] = Array.from(
  new Set(ICON_GROUPS.flatMap(g => g.names))
)

/** Quick membership test used to validate AI-supplied icon names. */
export const ICON_NAME_SET = new Set(ICON_NAMES)
