// Technicians and specialists for maintenance assignments
export interface Technician {
  id: number;
  name: string;
  email: string;
  phone: string;
  specialty: 'plumbing' | 'electrical' | 'hvac' | 'carpentry' | 'painting' | 'general';
  experience: number; // years
  rating: number; // 1-5
  isAvailable: boolean;
  workingHours: string;
  avatar?: string;
} 

export const TECHNICIANS: Technician[] = [
  {
    id: 1,
    name: "John Smith",
    email: "john.smith@maintenance.com",
    phone: "+254-712-345678",
    specialty: "plumbing",
    experience: 8,
    rating: 4.8,
    isAvailable: true,
    workingHours: "8:00 AM - 6:00 PM",
    avatar: "https://api.dicebear.com/7.x/avatars/svg?seed=john"
  },
  {
    id: 2,
    name: "Mary Johnson",
    email: "mary.johnson@maintenance.com", 
    phone: "+254-722-456789",
    specialty: "electrical",
    experience: 6,
    rating: 4.9,
    isAvailable: true,
    workingHours: "7:00 AM - 5:00 PM",
    avatar: "https://api.dicebear.com/7.x/avatars/svg?seed=mary"
  },
  {
    id: 3,
    name: "David Wilson",
    email: "david.wilson@maintenance.com",
    phone: "+254-733-567890", 
    specialty: "hvac",
    experience: 10,
    rating: 4.7,
    isAvailable: false,
    workingHours: "8:00 AM - 6:00 PM",
    avatar: "https://api.dicebear.com/7.x/avatars/svg?seed=david"
  },
  {
    id: 4,
    name: "Sarah Brown",
    email: "sarah.brown@maintenance.com",
    phone: "+254-744-678901",
    specialty: "carpentry",
    experience: 5,
    rating: 4.6,
    isAvailable: true,
    workingHours: "9:00 AM - 7:00 PM",
    avatar: "https://api.dicebear.com/7.x/avatars/svg?seed=sarah"
  },
  {
    id: 5,
    name: "Michael Davis",
    email: "michael.davis@maintenance.com",
    phone: "+254-755-789012",
    specialty: "general",
    experience: 12,
    rating: 4.9,
    isAvailable: true,
    workingHours: "6:00 AM - 4:00 PM",
    avatar: "https://api.dicebear.com/7.x/avatars/svg?seed=michael"
  },
  {
    id: 6,
    name: "Lisa Anderson",
    email: "lisa.anderson@maintenance.com",
    phone: "+254-766-890123",
    specialty: "painting",
    experience: 4,
    rating: 4.5,
    isAvailable: true,
    workingHours: "8:00 AM - 5:00 PM",
    avatar: "https://api.dicebear.com/7.x/avatars/svg?seed=lisa"
  }
];