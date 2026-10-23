// Opponent names and countries. Names are invented; countries are drawn in proportion to
// approximate 2025 population (millions), so you meet about as many people from India
// and China as the real bracket would give you.

import type { Rng } from './engine';

interface Country {
  name: string;
  flag: string;
  pop: number; // millions, approximate
  names: string[];
}

export const COUNTRIES: Country[] = [
  { name: 'India', flag: '🇮🇳', pop: 1460, names: ['Aarav Sharma', 'Priya Nair', 'Rohan Iyer', 'Ananya Gupta', 'Vikram Rao', 'Meera Pillai', 'Arjun Singh', 'Kavya Reddy'] },
  { name: 'China', flag: '🇨🇳', pop: 1410, names: ['Wang Lei', 'Li Na', 'Zhang Wei', 'Liu Yang', 'Chen Jing', 'Zhao Min', 'Huang Tao', 'Wu Xia'] },
  { name: 'United States', flag: '🇺🇸', pop: 347, names: ['Jordan Miller', 'Emily Johnson', 'Marcus Brown', 'Ashley Davis', 'Tyler Wilson', 'Grace Lee'] },
  { name: 'Indonesia', flag: '🇮🇩', pop: 285, names: ['Budi Santoso', 'Siti Rahayu', 'Agus Wijaya', 'Dewi Lestari'] },
  { name: 'Pakistan', flag: '🇵🇰', pop: 255, names: ['Ali Raza', 'Ayesha Khan', 'Hamza Malik', 'Fatima Qureshi', 'Usman Tariq'] },
  { name: 'Nigeria', flag: '🇳🇬', pop: 237, names: ['Chinedu Okafor', 'Amina Bello', 'Tunde Adeyemi', 'Ngozi Eze'] },
  { name: 'Brazil', flag: '🇧🇷', pop: 212, names: ['Lucas Silva', 'Ana Souza', 'Gabriel Costa', 'Beatriz Lima'] },
  { name: 'Bangladesh', flag: '🇧🇩', pop: 175, names: ['Rahim Uddin', 'Nusrat Jahan', 'Tanvir Ahmed', 'Farzana Akter'] },
  { name: 'Russia', flag: '🇷🇺', pop: 144, names: ['Dmitri Ivanov', 'Olga Smirnova', 'Sergei Petrov', 'Anna Volkova'] },
  { name: 'Ethiopia', flag: '🇪🇹', pop: 135, names: ['Abebe Tesfaye', 'Hiwot Alemu', 'Dawit Bekele', 'Selam Girma'] },
  { name: 'Mexico', flag: '🇲🇽', pop: 131, names: ['Diego Hernández', 'Sofía García', 'Javier López', 'Valeria Martínez'] },
  { name: 'Japan', flag: '🇯🇵', pop: 123, names: ['Haruto Sato', 'Yui Suzuki', 'Kenji Takahashi', 'Aoi Tanaka'] },
  { name: 'Egypt', flag: '🇪🇬', pop: 118, names: ['Omar Hassan', 'Nour Mahmoud', 'Youssef Ibrahim', 'Mariam Adel'] },
  { name: 'Philippines', flag: '🇵🇭', pop: 116, names: ['Jose Reyes', 'Maria Santos', 'Paolo Cruz', 'Angelica Bautista'] },
  { name: 'DR Congo', flag: '🇨🇩', pop: 112, names: ['Patrice Mbuyi', 'Grace Kabila', 'Jean Ilunga', 'Esther Kasongo'] },
  { name: 'Vietnam', flag: '🇻🇳', pop: 101, names: ['Nguyen Minh', 'Tran Thi Lan', 'Le Hoang', 'Pham Thu'] },
  { name: 'Iran', flag: '🇮🇷', pop: 92, names: ['Reza Ahmadi', 'Shirin Karimi', 'Amir Hosseini', 'Neda Rahimi'] },
  { name: 'Turkey', flag: '🇹🇷', pop: 87, names: ['Emre Yılmaz', 'Zeynep Kaya', 'Mehmet Demir', 'Elif Çelik'] },
  { name: 'Germany', flag: '🇩🇪', pop: 84, names: ['Lukas Müller', 'Hannah Schmidt', 'Felix Wagner', 'Lea Becker'] },
  { name: 'Thailand', flag: '🇹🇭', pop: 72, names: ['Somchai Srisuk', 'Nattaya Chaiyo', 'Anan Boonmee'] },
  { name: 'Tanzania', flag: '🇹🇿', pop: 70, names: ['Baraka Mushi', 'Neema Mollel', 'Juma Said'] },
  { name: 'United Kingdom', flag: '🇬🇧', pop: 69, names: ['Oliver Clarke', 'Amelia Hughes', 'Harry Evans', 'Isla Turner'] },
  { name: 'France', flag: '🇫🇷', pop: 66, names: ['Louis Martin', 'Chloé Bernard', 'Hugo Dubois', 'Camille Moreau'] },
  { name: 'South Africa', flag: '🇿🇦', pop: 64, names: ['Thabo Nkosi', 'Lerato Dlamini', 'Pieter van Wyk', 'Zanele Khumalo'] },
  { name: 'Italy', flag: '🇮🇹', pop: 59, names: ['Marco Rossi', 'Giulia Russo', 'Luca Ferrari', 'Chiara Esposito'] },
  { name: 'Kenya', flag: '🇰🇪', pop: 57, names: ['Brian Otieno', 'Wanjiru Kamau', 'Kevin Mutua'] },
  { name: 'Colombia', flag: '🇨🇴', pop: 53, names: ['Andrés Gómez', 'Camila Rodríguez', 'Santiago Díaz'] },
  { name: 'South Korea', flag: '🇰🇷', pop: 52, names: ['Kim Min-jun', 'Lee Seo-yeon', 'Park Ji-ho', 'Choi Yu-na'] },
  { name: 'Spain', flag: '🇪🇸', pop: 48, names: ['Pablo Fernández', 'Lucía Sánchez', 'Álvaro Ruiz'] },
  { name: 'Argentina', flag: '🇦🇷', pop: 46, names: ['Mateo González', 'Martina Pérez', 'Tomás Romero'] },
  { name: 'Canada', flag: '🇨🇦', pop: 40, names: ['Liam Tremblay', 'Olivia Roy', 'Noah Gagnon'] },
  { name: 'Poland', flag: '🇵🇱', pop: 38, names: ['Jakub Nowak', 'Zuzanna Kowalska', 'Kacper Wiśniewski'] },
  { name: 'Morocco', flag: '🇲🇦', pop: 38, names: ['Yassine Benali', 'Salma El Idrissi', 'Hamza Tazi'] },
  { name: 'Saudi Arabia', flag: '🇸🇦', pop: 34, names: ['Faisal Al-Harbi', 'Noura Al-Otaibi', 'Khalid Al-Qahtani'] },
  { name: 'Australia', flag: '🇦🇺', pop: 27, names: ['Jack Thompson', 'Chloe Mitchell', 'Ethan Walker'] },
  { name: 'Nepal', flag: '🇳🇵', pop: 30, names: ['Sujan Shrestha', 'Asmita Gurung', 'Bikash Thapa'] },
  { name: 'Ghana', flag: '🇬🇭', pop: 35, names: ['Kwame Mensah', 'Ama Owusu', 'Kofi Boateng'] },
  { name: 'Sweden', flag: '🇸🇪', pop: 11, names: ['Erik Lindqvist', 'Saga Nilsson'] },
  { name: 'New Zealand', flag: '🇳🇿', pop: 5, names: ['Tama Ngata', 'Ruby Clarke'] },
];

const TOTAL_WEIGHT = COUNTRIES.reduce((s, c) => s + c.pop, 0);

export interface Person {
  name: string;
  country: string;
  flag: string;
}

export function randomPerson(rng: Rng): Person {
  let r = rng() * TOTAL_WEIGHT;
  let country = COUNTRIES[COUNTRIES.length - 1];
  for (const c of COUNTRIES) {
    r -= c.pop;
    if (r < 0) {
      country = c;
      break;
    }
  }
  const name = country.names[Math.floor(rng() * country.names.length)];
  return { name, country: country.name, flag: country.flag };
}
