# Web Exploration Dashboard Frontend

A beautiful, real-time React TypeScript dashboard for AI-powered web exploration and scraping.

## 🚀 Features

### Real-Time Monitoring
- **Live Connection Status** - Real-time Socket.IO connection indicator
- **Active Tool Execution** - See what Claude is doing right now
- **Progress Tracking** - Step-by-step exploration progress
- **Screenshot Streaming** - Live screenshots as they're captured

### Intelligent Dashboard
- **6 Organized Tabs** for different aspects of exploration:
  - 🧠 **Decisions** - LLM reasoning and decision making
  - ⚡ **Tools** - Separate views for Observe, Extract, and Act tools
  - 📸 **Screenshots** - Live screenshot gallery
  - 🌐 **Network** - URL discovery and navigation flow
  - 📄 **Pages** - Page processing status
  - ✅ **Results** - Final exploration summary

### Modern UI/UX
- **shadcn/ui Components** - Beautiful, accessible components
- **Responsive Design** - Works on desktop, tablet, and mobile
- **Dark/Light Mode Support** - Automatic theme switching
- **Real-time Animations** - Loading states and progress indicators
- **Gradient Backgrounds** - Modern aesthetic

## 🛠️ Technology Stack

- **React 19** with TypeScript
- **React Router v7** for routing
- **Tailwind CSS** for styling
- **shadcn/ui** for components
- **Socket.IO Client** for real-time communication
- **Lucide React** for icons
- **Vite** for development and building

## 📦 Installation & Setup

```bash
# Navigate to frontend directory
cd frontend

# Install dependencies (already done)
npm install

# Start development server
npm run dev

# Build for production
npm run build

# Preview production build
npm run preview
```

## 🔌 Socket.IO Connection

The frontend automatically connects to the Socket.IO server at `http://localhost:3001`.

Make sure your backend Socket.IO server is running:

```bash
# In the main project directory
npm run socket:dev
```

## 🎮 Usage

### Starting an Exploration

1. **Connection**: Ensure you see the green "Connected" badge in the top right
2. **Configuration**: Fill in the exploration parameters:
   - **User Name**: Unique identifier for your session
   - **Start URL**: The website to explore
   - **Objective**: Describe what you want to achieve
   - **Exploration Mode**: Toggle for exploration vs task-focused mode
   - **Max Pages**: Limit the number of pages to explore (1-20)
3. **Start**: Click "Start Exploration" to begin

### Monitoring Progress

- **Current Status**: See the current page, active tool, and step count
- **Decisions Tab**: Watch Claude's reasoning process in real-time
- **Tools Tab**: See results from Observe, Extract, and Act tools
- **Screenshots Tab**: View live screenshots as they're captured
- **Network Tab**: Track URL discovery and navigation flow
- **Pages Tab**: Monitor page processing status
- **Results Tab**: View final exploration summary

### Controls

- **Stop**: Stop the exploration at any time
- **Real-time Updates**: All data updates automatically via Socket.IO
- **Auto-scroll**: Lists automatically scroll to show new items

## 🎨 UI Components

### Connection Status
```tsx
// Shows real-time connection status
<Badge variant={isConnected ? "default" : "destructive"}>
  {isConnected ? <Wifi /> : <WifiOff />}
  {isConnected ? "Connected" : "Disconnected"}
</Badge>
```

### Tool Execution Status
```tsx
// Shows current active tool with loading animation
{activeToolExecution ? (
  <div className="flex items-center gap-2">
    {getToolIcon(tool)}
    <span>{tool}</span>
    <Loader2 className="animate-spin" />
  </div>
) : (
  <span>Idle</span>
)}
```

### Real-time Updates
```tsx
// All updates come through Socket.IO
socket.on('exploration_update', (update) => {
  handleExplorationUpdate(update);
});
```

## 🔧 Configuration

### Socket URL
Edit `app/hooks/useSocket.ts` to change the Socket.IO server URL:

```typescript
const SOCKET_URL = 'http://localhost:3001';
```

### Default Settings
Edit `app/routes/home.tsx` to change default exploration settings:

```typescript
const [config, setConfig] = useState({
  userName: 'demo_user',
  objective: 'explore the entire website and discover all features',
  startUrl: 'https://example.com',
  isExploration: true,
  maxPagesToExplore: 6
});
```

## 🎯 Key Features Explained

### 1. LLM Decision Tracking
- Real-time display of Claude's decision-making process
- Shows tool selection, instructions, reasoning, and next plans
- Color-coded by tool type (blue=observe, green=extract, purple=act)

### 2. Tool Result Visualization
- **Observe**: Shows discovered elements, interactive elements, forms
- **Extract**: Displays extracted data and page structure
- **Act**: Shows action success/failure and URL changes

### 3. Screenshot Gallery
- Live screenshots with step numbers and timestamps
- Base64 encoded images for immediate display
- Responsive grid layout

### 4. Network Discovery
- Real-time URL discovery with source tracking
- Priority levels and queue sizes
- Complete navigation flow visualization

### 5. Page Status Monitoring
- Track processing status of all pages
- Show completed vs in-progress pages
- Step count for each page

### 6. Session Results
- Final exploration summary
- Page linkage visualization
- Objective achievement status
- Performance metrics (pages, actions, duration)

## 🚀 Development

### Adding New Components

```bash
# Add new shadcn/ui components
npx shadcn@latest add [component-name]
```

### Custom Hooks

The `useSocket` hook manages all Socket.IO communication:

```typescript
const { 
  explorationState, 
  startExploration, 
  stopExploration, 
  isConnected, 
  isRunning 
} = useSocket();
```

### Styling

Uses Tailwind CSS with shadcn/ui design tokens:

```tsx
<Card className="border-l-4 border-l-blue-500">
  <CardContent className="p-4">
    {/* Content */}
  </CardContent>
</Card>
```

## 🔍 Troubleshooting

### Connection Issues
- Ensure Socket.IO server is running on port 3001
- Check browser console for connection errors
- Verify CORS settings if running on different domains

### Build Issues
- Run `npm run build` to check for TypeScript errors
- Ensure all dependencies are installed
- Check for syntax errors in components

### Performance
- Large numbers of screenshots may impact performance
- Consider implementing pagination for tool results
- Use React.memo for expensive components

## 📱 Responsive Design

The dashboard is fully responsive:
- **Desktop**: Full 6-column tab layout
- **Tablet**: Responsive grid layouts
- **Mobile**: Stacked layouts with scrollable areas

## 🎨 Theming

Supports automatic dark/light mode detection and custom CSS variables for colors. All components use shadcn/ui design tokens for consistent theming.

## 📝 License

This frontend is part of the intelligent web scraping system. See the main project README for license information. 