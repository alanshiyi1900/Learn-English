import React, { useState, useRef, useEffect, useCallback } from 'react';
import { GoogleGenAI, LiveServerMessage, Modality } from '@google/genai';
import { LearningMode, Scenario, ChatMessage, ConnectionStatus } from './types';
import { createBlob, decode, decodeAudioData } from './utils/audioUtils';
import { AudioVisualizer } from './components/AudioVisualizer';

// --- Constants ---
const MODEL_NAME = 'gemini-2.5-flash-native-audio-preview-09-2025';
const INPUT_SAMPLE_RATE = 16000;
const OUTPUT_SAMPLE_RATE = 24000;

// --- Predefined Scenarios ---
const PREDEFINED_SCENARIOS: Scenario[] = [
  { id: 'coffee', title: 'Ordering Coffee', description: '点咖啡 / Café Order', icon: '☕' },
  { id: 'airport', title: 'At the Airport', description: '机场值机 / Check-in', icon: '✈️' },
  { id: 'intro', title: 'Self Introduction', description: '自我介绍 / Meet & Greet', icon: '👋' },
  { id: 'shopping', title: 'Shopping', description: '购物砍价 / Buying Clothes', icon: '🛍️' },
];

const App: React.FC = () => {
  // --- State ---
  const [currentStep, setCurrentStep] = useState<'setup' | 'session'>('setup');
  const [selectedScenario, setSelectedScenario] = useState<Scenario | null>(null);
  const [customScenario, setCustomScenario] = useState('');
  const [learningMode, setLearningMode] = useState<LearningMode>(LearningMode.FREE_TALK);
  const [status, setStatus] = useState<ConnectionStatus>('disconnected');
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [audioMode, setAudioMode] = useState<'listening' | 'speaking' | 'idle'>('idle');
  
  // --- Refs for Audio & AI ---
  const sessionRef = useRef<any>(null); // To hold the Live session
  const inputContextRef = useRef<AudioContext | null>(null);
  const outputContextRef = useRef<AudioContext | null>(null);
  const nextStartTimeRef = useRef<number>(0);
  const sourcesRef = useRef<Set<AudioBufferSourceNode>>(new Set());
  const streamRef = useRef<MediaStream | null>(null);
  const scriptProcessorRef = useRef<ScriptProcessorNode | null>(null);
  
  // Refs for transcription accumulation
  const currentInputTransRef = useRef<string>('');
  const currentOutputTransRef = useRef<string>('');

  // Scroll to bottom of chat
  const chatContainerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (chatContainerRef.current) {
      chatContainerRef.current.scrollTop = chatContainerRef.current.scrollHeight;
    }
  }, [messages]);

  // --- Logic: Start Session ---
  const startSession = async () => {
    if (!process.env.API_KEY) {
      alert('API Key is missing in environment variables.');
      return;
    }

    const finalScenario = customScenario.trim() ? { id: 'custom', title: 'Custom Topic', description: customScenario, icon: '✨' } : selectedScenario;
    if (!finalScenario) {
      alert('Please select or define a scenario.');
      return;
    }

    setStatus('connecting');
    setCurrentStep('session');
    setMessages([]);

    try {
      const ai = new GoogleGenAI({ apiKey: process.env.API_KEY });
      
      // Initialize Audio Contexts
      inputContextRef.current = new (window.AudioContext || (window as any).webkitAudioContext)({ sampleRate: INPUT_SAMPLE_RATE });
      outputContextRef.current = new (window.AudioContext || (window as any).webkitAudioContext)({ sampleRate: OUTPUT_SAMPLE_RATE });
      nextStartTimeRef.current = 0;

      // Get Microphone Stream
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      streamRef.current = stream;

      // Define System Instruction based on Mode
      let systemInstruction = '';
      if (learningMode === LearningMode.GUIDED_TRANSLATION) {
        systemInstruction = `
          You are an expert English tutor for Chinese beginners. 
          The current scenario is: "${finalScenario.title} - ${finalScenario.description}".
          
          YOUR BEHAVIOR:
          1. Speak a short, simple sentence in CHINESE related to this scenario.
          2. Wait for the user to speak the English translation.
          3. If the user's English is grammatically correct and understandable:
             - Praise them briefly in English.
             - Then give the NEXT Chinese sentence for them to translate.
          4. If the user makes a mistake (grammar, wrong word, bad pronunciation):
             - Explain the mistake gently in CHINESE.
             - Ask them to try again or provide the correct English sentence and ask them to repeat it.
          
          Keep your tone encouraging and patient. Do not give long lectures.
        `;
      } else {
        systemInstruction = `
          You are a friendly English conversation partner for a Chinese beginner student.
          The topic is: "${finalScenario.title} - ${finalScenario.description}".

          YOUR BEHAVIOR:
          1. Start a conversation in English about the topic. Keep sentences simple (CEFR A1/A2 level).
          2. Listen to the user's response.
          3. If the user makes a significant grammar or pronunciation error that affects meaning:
             - Briefly correct them in CHINESE.
             - Then continue the conversation in English.
          4. If the user struggles, you can offer a hint in Chinese.
          5. Otherwise, just chat naturally.
          
          Your goal is to keep the conversation flowing while providing subtle corrections.
        `;
      }

      // Connect to Live API
      const sessionPromise = ai.live.connect({
        model: MODEL_NAME,
        config: {
          responseModalities: [Modality.AUDIO],
          systemInstruction: systemInstruction,
          speechConfig: {
            voiceConfig: { prebuiltVoiceConfig: { voiceName: 'Kore' } },
          },
          inputAudioTranscription: { model: 'google-default' },
          outputAudioTranscription: { model: 'google-default' },
        },
        callbacks: {
          onopen: () => {
            setStatus('connected');
            setupAudioInput(sessionPromise);
          },
          onmessage: (msg) => handleLiveMessage(msg),
          onclose: () => {
            console.log('Session closed');
            setStatus('disconnected');
          },
          onerror: (err) => {
            console.error('Session error', err);
            setStatus('error');
          }
        }
      });

      sessionRef.current = sessionPromise;

    } catch (error) {
      console.error("Failed to start session:", error);
      setStatus('error');
    }
  };

  // --- Logic: Audio Input Streaming ---
  const setupAudioInput = (sessionPromise: Promise<any>) => {
    if (!inputContextRef.current || !streamRef.current) return;

    const source = inputContextRef.current.createMediaStreamSource(streamRef.current);
    const scriptProcessor = inputContextRef.current.createScriptProcessor(4096, 1, 1);
    scriptProcessorRef.current = scriptProcessor;

    scriptProcessor.onaudioprocess = (e) => {
      const inputData = e.inputBuffer.getChannelData(0);
      const pcmBlob = createBlob(inputData);
      
      sessionPromise.then(session => {
        session.sendRealtimeInput({ media: pcmBlob });
      });
    };

    source.connect(scriptProcessor);
    scriptProcessor.connect(inputContextRef.current.destination);
  };

  // --- Logic: Handle Live Messages ---
  const handleLiveMessage = async (message: LiveServerMessage) => {
    const { serverContent } = message;
    
    // 1. Handle Audio Output
    const base64Audio = serverContent?.modelTurn?.parts?.[0]?.inlineData?.data;
    if (base64Audio && outputContextRef.current) {
      setAudioMode('speaking');
      
      // Adjust start time
      nextStartTimeRef.current = Math.max(nextStartTimeRef.current, outputContextRef.current.currentTime);

      const audioBuffer = await decodeAudioData(
        decode(base64Audio),
        outputContextRef.current,
        OUTPUT_SAMPLE_RATE,
        1
      );

      const source = outputContextRef.current.createBufferSource();
      source.buffer = audioBuffer;
      const gainNode = outputContextRef.current.createGain();
      source.connect(gainNode);
      gainNode.connect(outputContextRef.current.destination);
      
      source.start(nextStartTimeRef.current);
      nextStartTimeRef.current += audioBuffer.duration;
      sourcesRef.current.add(source);

      source.onended = () => {
        sourcesRef.current.delete(source);
        if (sourcesRef.current.size === 0) {
           // Slight delay to revert to idle or listening
           setTimeout(() => setAudioMode('listening'), 200); 
        }
      };
    }

    // 2. Handle Transcriptions
    if (serverContent?.inputTranscription) {
      setAudioMode('listening');
      currentInputTransRef.current += serverContent.inputTranscription.text;
      // Update UI with partial
      updateLastMessage('user', currentInputTransRef.current, true);
    }

    if (serverContent?.outputTranscription) {
      currentOutputTransRef.current += serverContent.outputTranscription.text;
      updateLastMessage('model', currentOutputTransRef.current, true);
    }

    // 3. Handle Turn Complete (Commit messages)
    if (serverContent?.turnComplete) {
      if (currentInputTransRef.current) {
         updateLastMessage('user', currentInputTransRef.current, false);
         currentInputTransRef.current = '';
      }
      if (currentOutputTransRef.current) {
        updateLastMessage('model', currentOutputTransRef.current, false);
        currentOutputTransRef.current = '';
      }
      // If user turn is complete, we are waiting for model response audio, which is already streaming
    }
  };

  // Helper to update messages state
  const updateLastMessage = (role: 'user' | 'model', text: string, isPartial: boolean) => {
    setMessages(prev => {
      const lastMsg = prev[prev.length - 1];
      if (lastMsg && lastMsg.role === role && lastMsg.isPartial) {
        // Update existing partial message
        return [
          ...prev.slice(0, -1),
          { ...lastMsg, text, isPartial }
        ];
      } else {
        // Add new message
        return [
          ...prev,
          { id: Date.now().toString(), role, text, isPartial }
        ];
      }
    });
  };

  // --- Logic: Cleanup/End ---
  const endSession = useCallback(() => {
    // Close Live Session
    if (sessionRef.current) {
      sessionRef.current.then((session: any) => session.close());
      sessionRef.current = null;
    }

    // Stop Audio Stream
    if (streamRef.current) {
      streamRef.current.getTracks().forEach(track => track.stop());
      streamRef.current = null;
    }

    // Stop Audio Processing
    if (scriptProcessorRef.current && inputContextRef.current) {
        scriptProcessorRef.current.disconnect();
        scriptProcessorRef.current = null;
    }

    // Stop Playing Audio
    sourcesRef.current.forEach(source => source.stop());
    sourcesRef.current.clear();

    // Close Contexts
    inputContextRef.current?.close();
    outputContextRef.current?.close();

    setStatus('disconnected');
    setCurrentStep('setup');
    setAudioMode('idle');
    currentInputTransRef.current = '';
    currentOutputTransRef.current = '';
  }, []);

  // Cleanup on unmount
  useEffect(() => {
    return () => endSession();
  }, [endSession]);


  // --- RENDER ---

  if (currentStep === 'setup') {
    return (
      <div className="min-h-screen bg-slate-50 p-6 flex flex-col items-center max-w-md mx-auto">
        <header className="w-full mb-8 mt-4">
          <h1 className="text-3xl font-bold text-teal-600 text-center">YingYu Talk 🐼</h1>
          <p className="text-slate-500 text-center">English Tutor for Beginners</p>
        </header>

        {/* Mode Selection */}
        <div className="w-full bg-white p-4 rounded-2xl shadow-sm mb-6">
          <h2 className="text-sm font-bold text-slate-400 uppercase tracking-wider mb-3">Choose Mode</h2>
          <div className="flex gap-2">
            <button
              onClick={() => setLearningMode(LearningMode.GUIDED_TRANSLATION)}
              className={`flex-1 p-3 rounded-xl border-2 text-sm font-semibold transition-all ${
                learningMode === LearningMode.GUIDED_TRANSLATION
                  ? 'border-teal-500 bg-teal-50 text-teal-700'
                  : 'border-slate-100 text-slate-500 hover:bg-slate-50'
              }`}
            >
              🔁 Translation
              <span className="block text-xs font-normal mt-1 opacity-80">Translate Chinese to English</span>
            </button>
            <button
              onClick={() => setLearningMode(LearningMode.FREE_TALK)}
              className={`flex-1 p-3 rounded-xl border-2 text-sm font-semibold transition-all ${
                learningMode === LearningMode.FREE_TALK
                  ? 'border-teal-500 bg-teal-50 text-teal-700'
                  : 'border-slate-100 text-slate-500 hover:bg-slate-50'
              }`}
            >
              💬 Free Talk
              <span className="block text-xs font-normal mt-1 opacity-80">Casual conversation with corrections</span>
            </button>
          </div>
        </div>

        {/* Scenario Selection */}
        <div className="w-full flex-1">
          <h2 className="text-sm font-bold text-slate-400 uppercase tracking-wider mb-3">Select Scenario</h2>
          <div className="grid grid-cols-1 gap-3 mb-4">
            {PREDEFINED_SCENARIOS.map(s => (
              <button
                key={s.id}
                onClick={() => { setSelectedScenario(s); setCustomScenario(''); }}
                className={`flex items-center p-4 rounded-xl text-left transition-all ${
                  selectedScenario?.id === s.id && !customScenario
                    ? 'bg-teal-600 text-white shadow-md ring-2 ring-teal-200 ring-offset-2'
                    : 'bg-white text-slate-700 shadow-sm hover:bg-teal-50'
                }`}
              >
                <span className="text-2xl mr-4">{s.icon}</span>
                <div>
                  <div className="font-bold">{s.title}</div>
                  <div className="text-xs opacity-80">{s.description}</div>
                </div>
              </button>
            ))}
          </div>
          
          {/* Custom Scenario Input */}
          <div className="relative">
            <input
              type="text"
              placeholder="Or type any topic (e.g. 'Job Interview')"
              value={customScenario}
              onChange={(e) => { setCustomScenario(e.target.value); setSelectedScenario(null); }}
              className={`w-full p-4 rounded-xl border-2 outline-none transition-all ${
                customScenario ? 'border-teal-500 bg-white' : 'border-transparent bg-white shadow-sm'
              }`}
            />
            {customScenario && <span className="absolute right-4 top-4 text-teal-500">✨</span>}
          </div>
        </div>

        <button
          onClick={startSession}
          disabled={(!selectedScenario && !customScenario)}
          className="w-full mt-6 bg-slate-900 text-white py-4 rounded-2xl font-bold text-lg shadow-lg active:scale-95 transition-transform disabled:opacity-50 disabled:cursor-not-allowed"
        >
          Start Speaking
        </button>
      </div>
    );
  }

  // --- SESSION RENDER ---

  return (
    <div className="flex flex-col h-screen bg-white max-w-md mx-auto shadow-2xl overflow-hidden">
      {/* Session Header */}
      <div className="bg-slate-50 p-4 border-b border-slate-100 flex justify-between items-center z-10">
        <div>
          <h2 className="font-bold text-slate-800 truncate max-w-[200px]">
            {customScenario || selectedScenario?.title}
          </h2>
          <p className="text-xs text-teal-600 font-medium">
            {learningMode === LearningMode.GUIDED_TRANSLATION ? 'Guided Translation' : 'Free Talk'}
          </p>
        </div>
        <button 
          onClick={endSession}
          className="text-xs bg-slate-200 hover:bg-red-100 hover:text-red-600 text-slate-600 px-3 py-1.5 rounded-full font-bold transition-colors"
        >
          END
        </button>
      </div>

      {/* Chat Area */}
      <div ref={chatContainerRef} className="flex-1 overflow-y-auto p-4 space-y-4 scrollbar-hide bg-slate-50/50">
        {messages.length === 0 && (
          <div className="flex flex-col items-center justify-center h-full text-slate-400 text-sm text-center p-8">
            <p className="mb-2 text-4xl">🐼</p>
            <p>Connecting to AI Tutor...</p>
            <p className="text-xs mt-2">Microphone is on. Say "Hello"!</p>
          </div>
        )}

        {messages.map((msg) => (
          <div
            key={msg.id}
            className={`flex flex-col max-w-[85%] ${
              msg.role === 'user' ? 'self-end items-end' : 'self-start items-start'
            }`}
          >
             <span className="text-[10px] text-slate-400 mb-1 ml-1">
              {msg.role === 'user' ? 'You' : 'Tutor'}
            </span>
            <div
              className={`px-4 py-3 rounded-2xl text-sm leading-relaxed shadow-sm ${
                msg.role === 'user'
                  ? 'bg-teal-600 text-white rounded-tr-none'
                  : 'bg-white text-slate-800 border border-slate-100 rounded-tl-none'
              } ${msg.isPartial ? 'opacity-70' : ''}`}
            >
              {msg.text}
              {msg.isPartial && <span className="animate-pulse">...</span>}
            </div>
          </div>
        ))}
      </div>

      {/* Audio Controls Area */}
      <div className="bg-white border-t border-slate-100 p-6 pb-10 flex flex-col items-center justify-center relative">
        
        {/* Connection Error Overlay */}
        {status === 'error' && (
          <div className="absolute inset-0 bg-white/90 flex items-center justify-center z-20">
             <div className="text-center">
               <p className="text-red-500 font-bold mb-2">Connection Error</p>
               <button onClick={endSession} className="text-sm underline">Go Back</button>
             </div>
          </div>
        )}

        <div className="mb-4 text-center h-6">
           {status === 'connecting' && <p className="text-xs text-slate-400 animate-pulse">Establishing secure connection...</p>}
           {status === 'connected' && audioMode === 'listening' && <p className="text-xs text-teal-600 font-bold">Listening...</p>}
           {status === 'connected' && audioMode === 'speaking' && <p className="text-xs text-teal-600 font-bold">Speaking...</p>}
        </div>

        {/* The Orb / Visualizer */}
        <div className={`relative w-24 h-24 rounded-full flex items-center justify-center transition-all duration-500 ${
          audioMode === 'speaking' ? 'bg-teal-100 scale-110' : 
          audioMode === 'listening' ? 'bg-rose-50' : 'bg-slate-100'
        }`}>
          {/* Ripple effects */}
          {audioMode !== 'idle' && (
             <div className={`absolute w-full h-full rounded-full opacity-20 animate-ping ${
                audioMode === 'speaking' ? 'bg-teal-400' : 'bg-rose-400'
             }`}></div>
          )}
          
          <div className="z-10">
             <AudioVisualizer isActive={audioMode !== 'idle'} mode={audioMode} />
          </div>
        </div>

        <p className="mt-6 text-xs text-slate-400 text-center px-8">
           {learningMode === LearningMode.GUIDED_TRANSLATION 
             ? "Wait for the Chinese prompt, then say the English translation."
             : "Speak freely. The AI will correct your grammar gently."}
        </p>
      </div>
    </div>
  );
};

export default App;
