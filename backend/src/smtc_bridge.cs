using System;
using System.IO;
using System.Text;
using System.Threading;
using System.Reflection;
using System.Collections.Generic;

class SmtcBridge
{
    private static object manager = null;
    private static object currentSession = null;
    
    private static string lastTrackKey = "";
    private static string cachedBase64Thumbnail = "";

    // Reflection cached types and methods
    private static Type managerType;
    private static Type sessionType;
    private static Type mediaPropsType;
    private static Type playbackInfoType;
    private static Type timelinePropsType;
    private static Type streamReferenceType;
    private static Type randomAccessStreamType;
    private static Type dataReaderType;
    private static Type bufferType;
    private static Type extensionType;

    private static MethodInfo asTaskMethod;

    // Subscriptions
    private static object managerToken = null;
    private static object mediaPropsToken = null;
    private static object playbackInfoToken = null;
    private static object timelinePropsToken = null;

    private static object lockObject = new object();

    static void Main()
    {
        Console.OutputEncoding = Encoding.UTF8;
        try
        {
            InitializeReflection();
            InitializeSMTC();

            // Start a thread to read commands from stdin
            Thread commandThread = new Thread(ReadCommandsLoop);
            commandThread.IsBackground = true;
            commandThread.Start();

            // Main heartbeat loop
            while (true)
            {
                lock (lockObject)
                {
                    ReportCurrentState();
                }
                Thread.Sleep(1000);
            }
        }
        catch (Exception ex)
        {
            Console.WriteLine("{\"error\": " + JsonEscape(ex.ToString()) + "}");
        }
    }

    private static void InitializeReflection()
    {
        managerType = Type.GetType("Windows.Media.Control.GlobalSystemMediaTransportControlsSessionManager, Windows, ContentType=WindowsRuntime");
        sessionType = Type.GetType("Windows.Media.Control.GlobalSystemMediaTransportControlsSession, Windows, ContentType=WindowsRuntime");
        mediaPropsType = Type.GetType("Windows.Media.Control.GlobalSystemMediaTransportControlsSessionMediaProperties, Windows, ContentType=WindowsRuntime");
        playbackInfoType = Type.GetType("Windows.Media.Control.GlobalSystemMediaTransportControlsSessionPlaybackInfo, Windows, ContentType=WindowsRuntime");
        timelinePropsType = Type.GetType("Windows.Media.Control.GlobalSystemMediaTransportControlsSessionTimelineProperties, Windows, ContentType=WindowsRuntime");
        streamReferenceType = Type.GetType("Windows.Storage.Streams.IRandomAccessStreamReference, Windows, ContentType=WindowsRuntime");
        randomAccessStreamType = Type.GetType("Windows.Storage.Streams.IRandomAccessStream, Windows, ContentType=WindowsRuntime");
        dataReaderType = Type.GetType("Windows.Storage.Streams.DataReader, Windows, ContentType=WindowsRuntime");
        bufferType = Type.GetType("Windows.Storage.Streams.IBuffer, Windows, ContentType=WindowsRuntime");

        Assembly winrtAssembly = Assembly.Load("System.Runtime.WindowsRuntime, Version=4.0.0.0, Culture=neutral, PublicKeyToken=b77a5c561934e089");
        extensionType = winrtAssembly.GetType("System.WindowsRuntimeSystemExtensions");

        foreach (var m in extensionType.GetMethods())
        {
            if (m.Name == "AsTask" && m.GetParameters().Length == 1 && m.GetParameters()[0].ParameterType.Name.StartsWith("IAsyncOperation"))
            {
                asTaskMethod = m;
                break;
            }
        }
    }

    private static object AwaitOperation(object asyncOp, Type resultType)
    {
        var genericAsTask = asTaskMethod.MakeGenericMethod(resultType);
        var task = genericAsTask.Invoke(null, new object[] { asyncOp });
        task.GetType().GetMethod("Wait", new Type[0]).Invoke(task, null);
        return task.GetType().GetProperty("Result").GetValue(task);
    }

    private static void InitializeSMTC()
    {
        var requestAsyncMethod = managerType.GetMethod("RequestAsync", new Type[0]);
        var asyncOp = requestAsyncMethod.Invoke(null, null);
        manager = AwaitOperation(asyncOp, managerType);

        // Bind CurrentSessionChanged event
        var addSessionChanged = managerType.GetMethod("add_CurrentSessionChanged");
        var sessionChangedHandlerMethod = typeof(SmtcBridge).GetMethod("OnCurrentSessionChanged", BindingFlags.Static | BindingFlags.NonPublic);
        var delegateType = managerType.GetEvent("CurrentSessionChanged").EventHandlerType;
        var sessionChangedDelegate = Delegate.CreateDelegate(delegateType, sessionChangedHandlerMethod);
        managerToken = addSessionChanged.Invoke(manager, new object[] { sessionChangedDelegate });

        UpdateCurrentSession();
    }

    private static void OnCurrentSessionChanged(object sender, object args)
    {
        lock (lockObject)
        {
            UpdateCurrentSession();
            ReportCurrentState();
        }
    }

    private static void UpdateCurrentSession()
    {
        // Unsubscribe old session events
        UnsubscribeSessionEvents();

        var getCurrentSessionMethod = managerType.GetMethod("GetCurrentSession");
        currentSession = getCurrentSessionMethod.Invoke(manager, null);

        if (currentSession != null)
        {
            SubscribeSessionEvents();
        }
    }

    private static void SubscribeSessionEvents()
    {
        if (currentSession == null) return;

        // MediaPropertiesChanged
        var mediaPropsEvent = sessionType.GetEvent("MediaPropertiesChanged");
        var addMediaProps = sessionType.GetMethod("add_MediaPropertiesChanged");
        var mediaPropsHandler = typeof(SmtcBridge).GetMethod("OnMediaPropertiesChanged", BindingFlags.Static | BindingFlags.NonPublic);
        var mediaPropsDelegate = Delegate.CreateDelegate(mediaPropsEvent.EventHandlerType, mediaPropsHandler);
        mediaPropsToken = addMediaProps.Invoke(currentSession, new object[] { mediaPropsDelegate });

        // PlaybackInfoChanged
        var playbackInfoEvent = sessionType.GetEvent("PlaybackInfoChanged");
        var addPlaybackInfo = sessionType.GetMethod("add_PlaybackInfoChanged");
        var playbackInfoHandler = typeof(SmtcBridge).GetMethod("OnPlaybackInfoChanged", BindingFlags.Static | BindingFlags.NonPublic);
        var playbackInfoDelegate = Delegate.CreateDelegate(playbackInfoEvent.EventHandlerType, playbackInfoHandler);
        playbackInfoToken = addPlaybackInfo.Invoke(currentSession, new object[] { playbackInfoDelegate });

        // TimelinePropertiesChanged
        var timelinePropsEvent = sessionType.GetEvent("TimelinePropertiesChanged");
        var addTimelineProps = sessionType.GetMethod("add_TimelinePropertiesChanged");
        var timelinePropsHandler = typeof(SmtcBridge).GetMethod("OnTimelinePropertiesChanged", BindingFlags.Static | BindingFlags.NonPublic);
        var timelinePropsDelegate = Delegate.CreateDelegate(timelinePropsEvent.EventHandlerType, timelinePropsHandler);
        timelinePropsToken = addTimelineProps.Invoke(currentSession, new object[] { timelinePropsDelegate });
    }

    private static void UnsubscribeSessionEvents()
    {
        if (currentSession == null) return;

        try
        {
            if (mediaPropsToken != null)
            {
                var removeMediaProps = sessionType.GetMethod("remove_MediaPropertiesChanged");
                removeMediaProps.Invoke(currentSession, new object[] { mediaPropsToken });
                mediaPropsToken = null;
            }
            if (playbackInfoToken != null)
            {
                var removePlaybackInfo = sessionType.GetMethod("remove_PlaybackInfoChanged");
                removePlaybackInfo.Invoke(currentSession, new object[] { playbackInfoToken });
                playbackInfoToken = null;
            }
            if (timelinePropsToken != null)
            {
                var removeTimelineProps = sessionType.GetMethod("remove_TimelinePropertiesChanged");
                removeTimelineProps.Invoke(currentSession, new object[] { timelinePropsToken });
                timelinePropsToken = null;
            }
        }
        catch { }
    }

    private static void OnMediaPropertiesChanged(object sender, object args)
    {
        lock (lockObject)
        {
            ReportCurrentState();
        }
    }

    private static void OnPlaybackInfoChanged(object sender, object args)
    {
        lock (lockObject)
        {
            ReportCurrentState();
        }
    }

    private static void OnTimelinePropertiesChanged(object sender, object args)
    {
        lock (lockObject)
        {
            ReportCurrentState();
        }
    }

    private static void ReportCurrentState()
    {
        if (currentSession == null)
        {
            Console.WriteLine("{\"active\": false}");
            return;
        }

        string step = "init";
        try
        {
            // 1. Get Source App ID
            step = "1. SourceAppUserModelId";
            var sourceAppIdProp = sessionType.GetProperty("SourceAppUserModelId");
            if (sourceAppIdProp == null) throw new Exception("SourceAppUserModelId property not found on " + sessionType.FullName);
            string sourceAppId = (string)sourceAppIdProp.GetValue(currentSession);

            // 2. Get Media Properties
            step = "2. TryGetMediaPropertiesAsync";
            var tryGetPropsMethod = sessionType.GetMethod("TryGetMediaPropertiesAsync", new Type[0]);
            if (tryGetPropsMethod == null) throw new Exception("TryGetMediaPropertiesAsync method not found");
            var propsOp = tryGetPropsMethod.Invoke(currentSession, null);
            
            step = "2. AwaitOperation Props";
            var props = AwaitOperation(propsOp, mediaPropsType);
            if (props == null) throw new Exception("Media properties returned null");

            step = "2. Read props";
            string title = (string)mediaPropsType.GetProperty("Title").GetValue(props);
            string artist = (string)mediaPropsType.GetProperty("Artist").GetValue(props);
            string album = (string)mediaPropsType.GetProperty("AlbumTitle").GetValue(props);

            // 3. Get Thumbnail/Album Art
            step = "3. Thumbnail";
            string base64Thumbnail = "";
            string trackKey = title + " - " + artist + " - " + album;

            if (trackKey != lastTrackKey)
            {
                object thumbnailRef = mediaPropsType.GetProperty("Thumbnail").GetValue(props);
                if (thumbnailRef != null)
                {
                    try
                    {
                        var openReadMethod = streamReferenceType.GetMethod("OpenReadAsync", new Type[0]);
                        var streamOp = openReadMethod.Invoke(thumbnailRef, null);
                        Type streamType = Type.GetType("Windows.Storage.Streams.IRandomAccessStreamWithContentType, Windows, ContentType=WindowsRuntime");
                        object stream = AwaitOperation(streamOp, streamType);

                        ulong size = (ulong)randomAccessStreamType.GetProperty("Size").GetValue(stream);
                        var contentTypeProp = streamType.GetProperty("ContentType");
                        string contentType = contentTypeProp != null ? (string)contentTypeProp.GetValue(stream) : "unknown";
                        
                        Console.WriteLine("{\"log\": \"Thumbnail fetched: size=" + size + " bytes, type=" + contentType + "\"}");
                        if (size > 0)
                        {
                            var dataReader = Activator.CreateInstance(dataReaderType, new object[] { stream });
                            var loadOp = dataReaderType.GetMethod("LoadAsync").Invoke(dataReader, new object[] { (uint)size });
                            AwaitOperation(loadOp, typeof(uint));

                            byte[] buffer = new byte[size];
                            var readBytesMethod = dataReaderType.GetMethod("ReadBytes");
                            readBytesMethod.Invoke(dataReader, new object[] { buffer });

                            cachedBase64Thumbnail = Convert.ToBase64String(buffer);

                            try { ((IDisposable)stream).Dispose(); } catch { }
                            try { ((IDisposable)dataReader).Dispose(); } catch { }
                        }
                        else
                        {
                            cachedBase64Thumbnail = "";
                        }
                    }
                    catch (Exception ex)
                    {
                        Console.WriteLine("{\"log\": \"Thumbnail error: " + JsonEscape(ex.ToString()) + "\"}");
                        cachedBase64Thumbnail = "";
                    }
                }
                else
                {
                    cachedBase64Thumbnail = "";
                }
                lastTrackKey = trackKey;
            }

            base64Thumbnail = cachedBase64Thumbnail;

            // 4. Get Playback Info
            var getPlaybackInfoMethod = sessionType.GetMethod("GetPlaybackInfo");
            object playbackInfo = getPlaybackInfoMethod.Invoke(currentSession, null);
            object playbackStatusObj = playbackInfoType.GetProperty("PlaybackStatus").GetValue(playbackInfo);
            string status = playbackStatusObj.ToString(); // "Playing", "Paused", "Stopped" etc.

            // 5. Get Timeline Properties
            var getTimelinePropsMethod = sessionType.GetMethod("GetTimelineProperties");
            object timelineProps = getTimelinePropsMethod.Invoke(currentSession, null);
            
            // Timeline properties times are Windows.Foundation.TimeSpan which is represented as Struct in .NET
            // TimeSpans are standard .NET System.TimeSpan in projections
            TimeSpan position = (TimeSpan)timelinePropsType.GetProperty("Position").GetValue(timelineProps);
            TimeSpan duration = (TimeSpan)timelinePropsType.GetProperty("EndTime").GetValue(timelineProps);

            StringBuilder sb = new StringBuilder();
            sb.Append("{");
            sb.Append("\"active\":true,");
            sb.Append("\"appId\":" + JsonEscape(sourceAppId) + ",");
            sb.Append("\"title\":" + JsonEscape(title) + ",");
            sb.Append("\"artist\":" + JsonEscape(artist) + ",");
            sb.Append("\"album\":" + JsonEscape(album) + ",");
            sb.Append("\"status\":" + JsonEscape(status) + ",");
            sb.Append("\"positionMs\":" + (long)position.TotalMilliseconds + ",");
            sb.Append("\"durationMs\":" + (long)duration.TotalMilliseconds + ",");
            sb.Append("\"thumbnail\":" + JsonEscape(base64Thumbnail));
            sb.Append("}");

            Console.WriteLine(sb.ToString());
        }
        catch (Exception ex)
        {
            Console.WriteLine("{\"error\": " + JsonEscape("Step: " + step + ", " + ex.ToString()) + "}");
        }
    }

    private static void ReadCommandsLoop()
    {
        try
        {
            string line;
            while ((line = Console.ReadLine()) != null)
            {
                line = line.Trim().ToLower();
                if (string.IsNullOrEmpty(line)) continue;

                lock (lockObject)
                {
                    if (currentSession == null) continue;

                    try
                    {
                        if (line == "play")
                        {
                            var method = sessionType.GetMethod("TryPlayAsync");
                            var op = method.Invoke(currentSession, null);
                            // Run async in background, no need to wait
                        }
                        else if (line == "pause")
                        {
                            var method = sessionType.GetMethod("TryPauseAsync");
                            var op = method.Invoke(currentSession, null);
                        }
                        else if (line == "next")
                        {
                            var method = sessionType.GetMethod("TrySkipNextAsync");
                            var op = method.Invoke(currentSession, null);
                        }
                        else if (line == "previous")
                        {
                            var method = sessionType.GetMethod("TrySkipPreviousAsync");
                            var op = method.Invoke(currentSession, null);
                        }
                    }
                    catch (Exception ex)
                    {
                        Console.WriteLine("{\"error\": \"Control failed: " + JsonEscape(ex.Message) + "\"}");
                    }
                }
            }
        }
        catch { }
    }

    private static string JsonEscape(string s)
    {
        if (s == null) return "null";
        StringBuilder sb = new StringBuilder();
        sb.Append("\"");
        foreach (char c in s)
        {
            switch (c)
            {
                case '\\': sb.Append("\\\\"); break;
                case '"': sb.Append("\\\""); break;
                case '\n': sb.Append("\\n"); break;
                case '\r': sb.Append("\\r"); break;
                case '\t': sb.Append("\\t"); break;
                default:
                    if (c < ' ') sb.AppendFormat("\\u{0:x4}", (int)c);
                    else sb.Append(c);
                    break;
            }
        }
        sb.Append("\"");
        return sb.ToString();
    }
}
