import { useEffect, useMemo, useState } from 'react';

const ACTION_LOG_OPEN_KEY = 'tt_actionLogOpen';
const CHAT_STORAGE_KEY = 'tt_chat';

const loadActionLogOpen = () => {
  if (typeof window === 'undefined') {
    return true;
  }
  try {
    const raw = window.localStorage.getItem(ACTION_LOG_OPEN_KEY);
    if (raw === null) {
      return true;
    }
    return raw === 'true';
  } catch (error) {
    return true;
  }
};

const loadChatMessages = () => {
  if (typeof window === 'undefined') {
    return [];
  }
  try {
    const raw = window.localStorage.getItem(CHAT_STORAGE_KEY);
    const parsed = raw ? JSON.parse(raw) : [];
    return Array.isArray(parsed) ? parsed : [];
  } catch (error) {
    return [];
  }
};

const ActionLog = ({ entries, playerName }) => {
  const [isOpen, setIsOpen] = useState(loadActionLogOpen);
  const [activeTab, setActiveTab] = useState('log');
  const [chatMessages, setChatMessages] = useState(loadChatMessages);
  const [chatInput, setChatInput] = useState('');
  const formattedMessages = useMemo(
    () =>
      chatMessages.map((message) => ({
        ...message,
        timeLabel:
          typeof message.timestamp === 'number'
            ? new Date(message.timestamp).toLocaleTimeString([], {
                hour: '2-digit',
                minute: '2-digit'
              })
            : ''
      })),
    [chatMessages]
  );

  useEffect(() => {
    if (typeof window === 'undefined') {
      return;
    }
    try {
      window.localStorage.setItem(ACTION_LOG_OPEN_KEY, String(isOpen));
    } catch (error) {
      // noop
    }
  }, [isOpen]);

  useEffect(() => {
    if (typeof window === 'undefined') {
      return;
    }
    try {
      window.localStorage.setItem(CHAT_STORAGE_KEY, JSON.stringify(chatMessages));
    } catch (error) {
      // noop
    }
  }, [chatMessages]);

  const handleSend = () => {
    const trimmed = chatInput.trim();
    if (!trimmed) {
      return;
    }
    const message = {
      id: `${Date.now()}-${Math.random().toString(16).slice(2, 8)}`,
      name: playerName ?? 'Player',
      text: trimmed,
      timestamp: Date.now()
    };
    setChatMessages((prev) => [...prev, message]);
    setChatInput('');
  };

  if (!isOpen) {
    return (
      <button
        type="button"
        className="action-log__reopen"
        onClick={() => setIsOpen(true)}
      >
        Action Log
      </button>
    );
  }

  return (
    <section className="action-log" aria-label="Action log">
      <div className="action-log__header">
        <div className="action-log__tabs" role="tablist" aria-label="Activity tabs">
          <button
            type="button"
            className={`action-log__tab ${activeTab === 'log' ? 'is-active' : ''}`}
            role="tab"
            aria-selected={activeTab === 'log'}
            onClick={() => setActiveTab('log')}
          >
            Log
          </button>
          <button
            type="button"
            className={`action-log__tab ${activeTab === 'chat' ? 'is-active' : ''}`}
            role="tab"
            aria-selected={activeTab === 'chat'}
            onClick={() => setActiveTab('chat')}
          >
            Chat
          </button>
        </div>
        <button
          type="button"
          className="action-log__close"
          aria-label="Close action log"
          onClick={() => setIsOpen(false)}
        >
          ✕
        </button>
      </div>
      {activeTab === 'log' ? (
        <div className="action-log__entries" role="tabpanel">
          {entries?.length ? (
            entries.map((entry) => (
              <div key={entry.id} className="action-log__entry">
                {entry.text}
              </div>
            ))
          ) : (
            <div className="action-log__empty">No actions yet.</div>
          )}
        </div>
      ) : (
        <div className="action-log__chat" role="tabpanel">
          <div className="action-log__messages">
            {formattedMessages.length ? (
              formattedMessages.map((message) => (
                <div key={message.id} className="action-log__message">
                  <div className="action-log__message-meta">
                    <span className="action-log__message-name">{message.name}</span>
                    {message.timeLabel ? (
                      <span className="action-log__message-time">{message.timeLabel}</span>
                    ) : null}
                  </div>
                  <div className="action-log__message-text">{message.text}</div>
                </div>
              ))
            ) : (
              <div className="action-log__empty">No chat messages yet.</div>
            )}
          </div>
          <div className="action-log__input-row">
            <input
              type="text"
              className="action-log__input"
              placeholder="Type a message..."
              value={chatInput}
              onChange={(event) => setChatInput(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === 'Enter' && !event.shiftKey) {
                  event.preventDefault();
                  handleSend();
                }
              }}
            />
            <button type="button" className="action-log__send" onClick={handleSend}>
              Send
            </button>
          </div>
        </div>
      )}
    </section>
  );
};

export default ActionLog;
