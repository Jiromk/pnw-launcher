from __future__ import annotations
from typing import Any, Dict, List

class MarshalReader:
    def __init__(self, data: bytes):
        self.data = data
        self.pos = 0
        self.symbols: List[str] = []
        self.objects: List[Any] = []

    def read(self) -> Any:
        code = self._read_byte()
        if code == ord('0'):
            return None
        if code == ord('T'):
            return True
        if code == ord('F'):
            return False
        if code == ord('i'):
            return self._read_fixnum()
        if code == ord(':'):
            return self._read_symbol()
        if code == ord(';'):
            index = self._read_fixnum()
            return self.symbols[index]
        if code == ord('@'):
            index = self._read_fixnum()
            return self.objects[index]
        if code == ord('['):
            return self._read_array()
        if code == ord('{'):
            return self._read_hash()
        if code == ord('o'):
            return self._read_object()
        if code == ord('I'):
            return self._read_instance_var()
        if code == ord('"'):
            return self._read_string()
        if code == ord('l'):
            return self._read_bignum()
        if code == ord('f'):
            return self._read_float()
        if code == ord('C'):
            return self._read_user_class()
        if code == ord('u'):
            return self._read_user_defined()
        raise ValueError(f"Unsupported code {chr(code)!r} at position {self.pos-1}")

    def _read_byte(self) -> int:
        if self.pos >= len(self.data):
            raise EOFError('Unexpected end of data')
        b = self.data[self.pos]
        self.pos += 1
        return b

    def _read_bytes(self, length: int) -> bytes:
        if self.pos + length > len(self.data):
            raise EOFError('Unexpected end of data while reading bytes')
        b = self.data[self.pos:self.pos + length]
        self.pos += length
        return b

    def _read_fixnum(self) -> int:
        c = self._read_byte()
        if c == 0:
            return 0
        if 5 <= c <= 127:
            return c - 5
        if c >= 128:
            c -= 256
        if -128 <= c <= -5:
            return c + 5
        if 1 <= c <= 4:
            size = c
            n = 0
            for i in range(size):
                n |= self._read_byte() << (8 * i)
            return n
        if -4 <= c <= -1:
            size = -c
            n = 0
            for i in range(size):
                n |= self._read_byte() << (8 * i)
            mask = (1 << (size * 8)) - 1
            n ^= mask
            n = -n - 1
            return n
        raise ValueError(f'Invalid fixnum marker {c}')

    def _read_symbol(self) -> str:
        length = self._read_fixnum()
        name = self._read_bytes(length).decode('utf-8')
        self.symbols.append(name)
        return name

    def _read_string(self) -> Any:
        raw = self._read_string_raw()
        try:
            value = raw.decode('utf-8')
        except UnicodeDecodeError:
            value = raw
        self.objects.append(value)
        return value

    def _read_string_raw(self) -> bytes:
        length = self._read_fixnum()
        return self._read_bytes(length)

    def _read_float(self) -> float:
        text = self._read_string_raw().decode('utf-8')
        if text == 'inf':
            value = float('inf')
        elif text == '-inf':
            value = float('-inf')
        elif text == 'nan':
            value = float('nan')
        else:
            value = float(text)
        self.objects.append(value)
        return value

    def _read_array(self) -> List[Any]:
        length = self._read_fixnum()
        arr: List[Any] = []
        self.objects.append(arr)
        for _ in range(length):
            arr.append(self.read())
        return arr

    def _normalize_key(self, value: Any) -> Any:
        if isinstance(value, list):
            return tuple(self._normalize_key(v) for v in value)
        if isinstance(value, dict):
            return frozenset((self._normalize_key(k), self._normalize_key(v)) for k, v in value.items())
        return value

    def _read_hash(self) -> Dict[Any, Any]:
        length = self._read_fixnum()
        h: Dict[Any, Any] = {}
        self.objects.append(h)
        for _ in range(length):
            key = self.read()
            value = self.read()
            h[self._normalize_key(key)] = value
        return h

    def _read_object(self) -> Any:
        class_name = self.read()
        ivar_count = self._read_fixnum()
        obj: Dict[Any, Any] = {'__class__': class_name}
        self.objects.append(obj)
        for _ in range(ivar_count):
            key = self.read()
            value = self.read()
            obj[key] = value
        return obj

    def _read_user_class(self) -> Any:
        class_name = self.read()
        value = self.read()
        wrapped = {'__class__': class_name, '__value__': value}
        self.objects.append(wrapped)
        return wrapped

    def _read_user_defined(self) -> Any:
        class_name = self.read()
        raw = self._read_string_raw()
        obj = {'__class__': class_name, '__raw__': raw}
        self.objects.append(obj)
        return obj

    def _read_instance_var(self) -> Any:
        base = self.read()
        ivars = self._read_fixnum()
        for _ in range(ivars):
            key = self.read()
            value = self.read()
            if isinstance(base, str) and key in {"E", "encoding"}:
                continue
        return base

    def _read_bignum(self) -> int:
        sign = self._read_byte()
        length_words = self._read_fixnum()
        total_bytes = length_words * 2
        raw = self._read_bytes(total_bytes)
        num = 0
        for i in range(total_bytes):
            num |= raw[i] << (8 * i)
        if sign == ord('-'):
            num = -num
        self.objects.append(num)
        return num


def load(data: bytes) -> Any:
    if data.startswith(b'PKPRT'):
        data = data[5:]
        if data[0:2] != b"\x04\x08":
            raise ValueError('Unsupported Marshal version')
        payload = data[2:]
    elif data[0:2] == b"\x04\x08":
        payload = data[2:]
    elif len(data) > 10 and data[8:10] == b"\x04\x08":
        payload = data[10:]
    else:
        raise ValueError('Unexpected header')
    reader = MarshalReader(payload)
    return reader.read()
