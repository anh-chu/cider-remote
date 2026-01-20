import React, { useState, useEffect } from 'react';
import { Download, RefreshCw, X, CheckCircle, AlertCircle } from 'lucide-react';

const UpdateNotification = () => {
  const [updateState, setUpdateState] = useState('idle');
  const [updateInfo, setUpdateInfo] = useState(null);
  const [downloadProgress, setDownloadProgress] = useState(0);
  const [showNotification, setShowNotification] = useState(false);
  const [appVersion, setAppVersion] = useState(null);
  const [updateChannel, setUpdateChannel] = useState('latest');

  useEffect(() => {
    // Check if running in Electron
    if (!window.electron) {
      return;
    }

    // Fetch app version
    const fetchVersion = async () => {
      try {
        const version = await window.electron.ipcRenderer.invoke('get-app-version');
        setAppVersion(version);
      } catch (err) {
        console.error('Failed to get app version:', err);
      }
    };

    fetchVersion();

    // Load channel preference from localStorage
    const loadChannel = () => {
      try {
        const saved = localStorage.getItem('update_channel');
        const channel = saved || 'latest';
        setUpdateChannel(channel);
        // Send to main process
        if (window.electron) {
          window.electron.ipcRenderer.send('set-update-channel', channel);
        }
      } catch (err) {
        console.error('Failed to load update channel:', err);
        setUpdateChannel('latest');
      }
    };

    loadChannel();

    const handleUpdateStatus = (event, { event: updateEvent, data }) => {
      console.log('Update event:', updateEvent, data);

      switch (updateEvent) {
        case 'checking-for-update':
          setUpdateState('checking');
          break;

        case 'update-available':
          setUpdateState('available');
          setUpdateInfo(data);
          setShowNotification(true);
          break;

        case 'update-not-available':
          setUpdateState('not-available');
          setTimeout(() => {
            setShowNotification(false);
            setUpdateState('idle');
          }, 3000);
          break;

        case 'download-progress':
          setUpdateState('downloading');
          setDownloadProgress(data.percent);
          setShowNotification(true);
          break;

        case 'update-downloaded':
          setUpdateState('downloaded');
          setUpdateInfo(data);
          setShowNotification(true);
          break;

        case 'error':
          setUpdateState('error');
          setUpdateInfo(data);
          setShowNotification(true);
          setTimeout(() => {
            setShowNotification(false);
            setUpdateState('idle');
          }, 5000);
          break;

        default:
          break;
      }
    };

    window.electron.ipcRenderer.on('update-status', handleUpdateStatus);

    return () => {
      window.electron.ipcRenderer.removeListener('update-status', handleUpdateStatus);
    };
  }, []);

  const handleDownload = () => {
    if (window.electron) {
      window.electron.ipcRenderer.send('download-update');
    }
  };

  const handleInstall = () => {
    if (window.electron) {
      window.electron.ipcRenderer.send('install-update');
    }
  };

  const handleCheckForUpdates = () => {
    if (window.electron) {
      setShowNotification(true);
      window.electron.ipcRenderer.send('check-for-updates');
    }
  };

  const handleClose = () => {
    setShowNotification(false);
  };

  const handleChannelChange = (newChannel) => {
    if (updateChannel === newChannel) return;

    try {
      localStorage.setItem('update_channel', newChannel);
      setUpdateChannel(newChannel);
      window.electron.ipcRenderer.send('set-update-channel', newChannel);

      // Show notification and trigger update check
      setShowNotification(true);
      setUpdateState('checking');
      setTimeout(() => {
        window.electron.ipcRenderer.send('check-for-updates');
      }, 500);
    } catch (err) {
      console.error('Failed to change channel:', err);
    }
  };

  if (!showNotification) {
    return (
      <div className="fixed bottom-4 right-4 group">
        <button
          onClick={handleCheckForUpdates}
          className="bg-white/10 hover:bg-white/20 text-white rounded-full p-3 shadow-lg backdrop-blur-xl border border-white/10 transition-all hover:scale-105"
        >
          <RefreshCw size={20} />
        </button>
        {appVersion && (
          <div className="absolute bottom-1/2 right-full mr-3 transform translate-y-1/2 opacity-0 group-hover:opacity-100 transition-opacity pointer-events-none whitespace-nowrap">
            <div className="bg-black/90 text-white text-sm px-3 py-2 rounded-lg border border-white/10 backdrop-blur-xl">
              Current: v{appVersion}
              <div className="text-xs text-white/60 mt-1">
                Channel: {updateChannel}
              </div>
              <div className="absolute left-full top-1/2 transform -translate-y-1/2 border-4 border-transparent border-l-black/90"></div>
            </div>
          </div>
        )}
      </div>
    );
  }

  return (
    <div className="fixed bottom-4 right-4 bg-black/90 backdrop-blur-xl border border-white/10 rounded-2xl p-4 shadow-2xl max-w-sm w-80 animate-slide-up">
      <div className="flex items-start justify-between mb-3">
        <div className="flex items-center gap-2">
          {updateState === 'checking' && <RefreshCw size={20} className="text-blue-400 animate-spin" />}
          {updateState === 'available' && <Download size={20} className="text-green-400" />}
          {updateState === 'downloading' && <Download size={20} className="text-blue-400 animate-pulse" />}
          {updateState === 'downloaded' && <CheckCircle size={20} className="text-green-400" />}
          {updateState === 'error' && <AlertCircle size={20} className="text-red-400" />}
          {updateState === 'not-available' && <CheckCircle size={20} className="text-gray-400" />}

          <h3 className="text-white font-semibold">
            {updateState === 'checking' && 'Checking for updates...'}
            {updateState === 'available' && 'Update available!'}
            {updateState === 'downloading' && 'Downloading update...'}
            {updateState === 'downloaded' && 'Update ready!'}
            {updateState === 'error' && 'Update error'}
            {updateState === 'not-available' && 'Up to date'}
          </h3>
        </div>

        <button
          onClick={handleClose}
          className="text-white/60 hover:text-white transition-colors"
        >
          <X size={18} />
        </button>
      </div>

      {/* Channel Switcher */}
      <div className="flex gap-2 mb-3">
        <button
          onClick={() => handleChannelChange('latest')}
          className={`flex-1 px-3 py-2 rounded-lg text-sm font-medium transition-all ${
            updateChannel === 'latest'
              ? 'bg-blue-500 text-white'
              : 'bg-white/10 text-white/70 hover:bg-white/20'
          }`}
        >
          Release
        </button>
        <button
          onClick={() => handleChannelChange('dev')}
          className={`flex-1 px-3 py-2 rounded-lg text-sm font-medium transition-all ${
            updateChannel === 'dev'
              ? 'bg-purple-500 text-white'
              : 'bg-white/10 text-white/70 hover:bg-white/20'
          }`}
        >
          Dev
        </button>
      </div>

      {/* Dev Channel Warning */}
      {updateChannel === 'dev' && (
        <div className="bg-yellow-500/10 border border-yellow-500/20 rounded-lg p-2 mb-3">
          <p className="text-xs text-yellow-400">
            ⚠️ Dev builds may contain unstable features or bugs
          </p>
        </div>
      )}

      <div className="text-sm text-white/70 mb-3">
        {updateState === 'checking' && (
          <p>Looking for new versions...</p>
        )}
        {updateState === 'available' && updateInfo && (
          <p>Version {updateInfo.version} is now available</p>
        )}
        {updateState === 'downloading' && (
          <div>
            <p className="mb-2">Downloading update...</p>
            <div className="w-full bg-white/10 rounded-full h-2 overflow-hidden">
              <div
                className="bg-blue-500 h-full transition-all duration-300"
                style={{ width: `${downloadProgress}%` }}
              />
            </div>
            <p className="text-xs text-white/50 mt-1">{Math.round(downloadProgress)}%</p>
          </div>
        )}
        {updateState === 'downloaded' && updateInfo && (
          <p>Version {updateInfo.version} has been downloaded and is ready to install</p>
        )}
        {updateState === 'error' && updateInfo && (
          <p className="text-red-400">{updateInfo.message}</p>
        )}
        {updateState === 'not-available' && (
          <p>You're running the latest version</p>
        )}
      </div>

      {updateState === 'available' && (
        <button
          onClick={handleDownload}
          className="w-full bg-green-500 hover:bg-green-600 text-white rounded-lg py-2 px-4 font-medium transition-all flex items-center justify-center gap-2"
        >
          <Download size={16} />
          Download Update
        </button>
      )}

      {updateState === 'downloaded' && (
        <button
          onClick={handleInstall}
          className="w-full bg-blue-500 hover:bg-blue-600 text-white rounded-lg py-2 px-4 font-medium transition-all flex items-center justify-center gap-2"
        >
          <RefreshCw size={16} />
          Install & Restart
        </button>
      )}
    </div>
  );
};

export default UpdateNotification;
