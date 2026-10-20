package io.focusworkspace.app.ai;

/** One native model; calls except cancel/prepare are serialized by LocalAIPlugin. */
public final class NativeEngine {
    static { System.loadLibrary("focus_ai"); }
    public interface Tokens { void onTokenBytes(byte[] bytes); }
    public static native void init(String libraryDirectory);
    public static native void prepare();
    public static native void cancel();
    public static native void load(String path);
    public static native void unload();
    public static native long[] generate(byte[] prompt, int maxTokens, boolean json, Tokens listener);
    private NativeEngine() {}
}
