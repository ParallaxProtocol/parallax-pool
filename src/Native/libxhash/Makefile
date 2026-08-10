CFLAGS += -g -Wall -c -fPIC -O2 -std=c11 -Iinclude $(CPU_FLAGS) $(HAVE_FEATURE)
CXXFLAGS += -g -Wall -fPIC -O2 -std=c++14 -fno-rtti -Iinclude $(CPU_FLAGS) $(HAVE_FEATURE)
LDFLAGS += -shared
TARGET = libxhash.so

OBJECTS = keccak.o sha3.o primes.o xhash.o exports.o

all: $(TARGET)

$(TARGET): $(OBJECTS)
	$(CXX) $(LDFLAGS) -o $@ $^ $(LDLIBS)

keccak.o: lib/keccak/keccak.c
	$(CC) $(CFLAGS) -o $@ $<

sha3.o: lib/sha3/sha3.c
	$(CC) $(CFLAGS) -o $@ $<

primes.o: lib/xhash/primes.c
	$(CC) $(CFLAGS) -o $@ $<

xhash.o: lib/xhash/xhash.cpp
	$(CXX) $(CXXFLAGS) -c -o $@ $<

exports.o: exports.cpp
	$(CXX) $(CXXFLAGS) -c -o $@ $<

.PHONY: clean

clean:
	$(RM) $(TARGET) $(OBJECTS)
