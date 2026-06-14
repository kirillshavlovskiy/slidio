import {
  TrendingUp, TrendingDown, Activity, BarChart3, LineChart, PieChart, AreaChart,
  Gauge, Target, Percent, Scale, SlidersHorizontal,
  DollarSign, CircleDollarSign, Banknote, CreditCard, Wallet, Coins, PiggyBank,
  Briefcase, Building2, Landmark, Handshake, ShoppingCart, Package, Truck, Factory, Receipt,
  Rocket, Lightbulb, Brain, Sparkles, Wand2, Compass, Map, MapPin, Flag, Milestone,
  Route, Puzzle, Workflow, GitBranch,
  CheckCircle2, XCircle, AlertTriangle, AlertCircle, Info, BadgeCheck, ShieldCheck,
  Shield, Award, Trophy, Star, ThumbsUp, Flame, Heart,
  User, Users, UserCheck, UserPlus, Contact, Network, Globe, Globe2, GraduationCap, Building,
  Database, Server, Cloud, Cpu, Code2, Terminal, Smartphone, Monitor, Laptop, Wifi, Plug,
  Battery, Lock, Unlock, Key, Settings, Cog, Wrench, Filter, Search, Layers, Box,
  Calendar, Clock, Timer, Hourglass, FileText, File, Folder, Clipboard, ClipboardCheck,
  BookOpen, Book, Bell, Mail, MessageSquare, Phone, Send, Share2, Link, Eye,
  ArrowUpRight, ArrowDownRight, ArrowRight, ArrowUp, ArrowDown, ChevronRight, Plus, Minus,
  Check, X, RefreshCw, Repeat, Zap, Leaf, TreePine, Sun, Moon, Droplet, Recycle, Anchor,
  Plane, Home,
  type LucideIcon,
} from 'lucide-react'

export { ICON_GROUPS, ICON_NAMES, ICON_NAME_SET } from './iconNames'

/** name → lucide component. The picker and renderer both resolve icons from here. */
export const ICON_MAP: Record<string, LucideIcon> = {
  TrendingUp, TrendingDown, Activity, BarChart3, LineChart, PieChart, AreaChart,
  Gauge, Target, Percent, Scale, SlidersHorizontal,
  DollarSign, CircleDollarSign, Banknote, CreditCard, Wallet, Coins, PiggyBank,
  Briefcase, Building2, Landmark, Handshake, ShoppingCart, Package, Truck, Factory, Receipt,
  Rocket, Lightbulb, Brain, Sparkles, Wand2, Compass, Map, MapPin, Flag, Milestone,
  Route, Puzzle, Workflow, GitBranch,
  CheckCircle2, XCircle, AlertTriangle, AlertCircle, Info, BadgeCheck, ShieldCheck,
  Shield, Award, Trophy, Star, ThumbsUp, Flame, Heart,
  User, Users, UserCheck, UserPlus, Contact, Network, Globe, Globe2, GraduationCap, Building,
  Database, Server, Cloud, Cpu, Code2, Terminal, Smartphone, Monitor, Laptop, Wifi, Plug,
  Battery, Lock, Unlock, Key, Settings, Cog, Wrench, Filter, Search, Layers, Box,
  Calendar, Clock, Timer, Hourglass, FileText, File, Folder, Clipboard, ClipboardCheck,
  BookOpen, Book, Bell, Mail, MessageSquare, Phone, Send, Share2, Link, Eye,
  ArrowUpRight, ArrowDownRight, ArrowRight, ArrowUp, ArrowDown, ChevronRight, Plus, Minus,
  Check, X, RefreshCw, Repeat, Zap, Leaf, TreePine, Sun, Moon, Droplet, Recycle, Anchor,
  Plane, Home,
}

/** Default icon used when an element has no/unknown icon name. */
export const DEFAULT_ICON_NAME = 'Star'

/** Resolve a lucide component by name, falling back to the default. */
export function getIcon(name?: string): LucideIcon {
  return (name && ICON_MAP[name]) || ICON_MAP[DEFAULT_ICON_NAME]
}
