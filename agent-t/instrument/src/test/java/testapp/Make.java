package testapp;

/** Instantiates the concrete "$Impl" subclass the test class loader generates for an abstract stub. */
public final class Make {
    private Make() { }

    public static Object of(Class<?> abstractStub) {
        try {
            return Class.forName(abstractStub.getName() + "$Impl", true, abstractStub.getClassLoader()).newInstance();
        } catch (Exception e) {
            throw new IllegalStateException(e);
        }
    }
}
