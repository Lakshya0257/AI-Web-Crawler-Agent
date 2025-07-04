# 🚀 Quick Start Guide - UI-Driven Web Exploration

## ⚡ Start Both Servers

### 1. Start Backend Socket.IO Server (Terminal 1)
```bash
cd /Users/lakshyabhati/Documents/Figr/scrapping
npm run socket:dev
```
**This starts the Socket.IO server on port 3001 that handles UI input**

### 2. Start Frontend Dashboard (Terminal 2)
```bash
cd /Users/lakshyabhati/Documents/Figr/scrapping/frontend
npm run dev
```
**This starts the React frontend on port 5173**

## 🌐 Access the Dashboard

Open your browser and go to: **http://localhost:5173**

## 🎮 How to Use

1. **Check Connection**: Look for the green "Connected" badge in the top right
2. **Fill Configuration**:
   - **User Name**: Enter any unique identifier (e.g., "demo_user")
   - **Start URL**: Enter the website to explore (e.g., "https://example.com")
   - **Objective**: Describe what you want to explore (e.g., "explore the entire website and discover all features")
   - **Exploration Mode**: Toggle ON for exploration, OFF for task-focused
   - **Max Pages**: Set how many pages to explore (1-20)

3. **Start Exploration**: Click the "Start Exploration" button
4. **Monitor Progress**: Watch real-time updates across all 6 tabs:
   - 🧠 **Decisions** - LLM reasoning
   - ⚡ **Tools** - Tool execution results
   - 📸 **Screenshots** - Live screenshots
   - 🌐 **Network** - URL discovery
   - 📄 **Pages** - Page status
   - ✅ **Results** - Final summary

## ❌ Don't Use These Commands

**WRONG** ❌ (This requires command line arguments):
```bash
npm run dev          # This tries to run src/index.ts with CLI args
npm start            # This also requires CLI args
```

**CORRECT** ✅ (This uses UI input):
```bash
npm run socket:dev   # Backend Socket.IO server
cd frontend && npm run dev  # Frontend dashboard
```

## 🔧 Current Status

- ✅ Socket.IO server running on port 3001
- ✅ Frontend dashboard running on port 5173
- ✅ Real-time communication active
- ✅ All input handled through beautiful UI
- ✅ No command line arguments needed

## 🎯 Key Features

- **No CLI Arguments**: Everything configured through the UI
- **Real-time Updates**: Live progress monitoring
- **Beautiful Interface**: Modern shadcn/ui components
- **6 Organized Tabs**: Different aspects of exploration
- **Live Screenshots**: See what the AI sees
- **LLM Decisions**: Watch Claude's reasoning process
- **Network Discovery**: URL relationship visualization

## 🐛 Troubleshooting

### Connection Issues
- Make sure both servers are running
- Check browser console for errors
- Verify ports 3001 and 5173 are not blocked

### Server Not Starting
- Check if ports are already in use: `lsof -i :3001` and `lsof -i :5173`
- Kill existing processes if needed: `kill -9 <PID>`
- Restart both servers

### Frontend Not Loading
- Clear browser cache
- Check network tab in browser dev tools
- Verify Socket.IO connection in console

Enjoy exploring the web with AI! 🚀 