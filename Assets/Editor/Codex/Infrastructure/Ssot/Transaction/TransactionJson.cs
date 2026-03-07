using System;
using System.Collections;
using System.Collections.Generic;
using System.Globalization;
using System.IO;
using System.Text;

namespace UnityAI.Editor.Codex.Infrastructure.Ssot.Transaction
{
    internal static class TransactionJson
    {
        public static bool TryParse(string json, out object value, out string errorMessage)
        {
            value = null;
            errorMessage = null;

            if (string.IsNullOrWhiteSpace(json))
            {
                errorMessage = "JSON payload is empty.";
                return false;
            }

            try
            {
                value = Parser.Parse(json);
                return true;
            }
            catch (Exception ex)
            {
                errorMessage = "JSON parse failed: " + ex.Message;
                return false;
            }
        }

        public static bool TryParseObject(string json, out Dictionary<string, object> value, out string errorMessage)
        {
            value = null;
            errorMessage = null;
            if (!TryParse(json, out var parsed, out errorMessage))
            {
                return false;
            }

            value = parsed as Dictionary<string, object>;
            if (value == null)
            {
                errorMessage = "JSON root must be an object.";
                return false;
            }

            return true;
        }

        public static string Serialize(object value)
        {
            return Serializer.Serialize(value);
        }

        private sealed class Parser : IDisposable
        {
            private const string WORD_BREAK = "{}[],:\"";
            private readonly StringReader _json;

            private Parser(string jsonString)
            {
                _json = new StringReader(jsonString);
            }

            public static object Parse(string jsonString)
            {
                using (var instance = new Parser(jsonString))
                {
                    return instance.ParseValue();
                }
            }

            public void Dispose()
            {
                _json.Dispose();
            }

            private enum Token
            {
                None,
                CurlyOpen,
                CurlyClose,
                SquaredOpen,
                SquaredClose,
                Colon,
                Comma,
                String,
                Number,
                True,
                False,
                Null
            }

            private Dictionary<string, object> ParseObject()
            {
                var table = new Dictionary<string, object>(StringComparer.Ordinal);

                _json.Read();

                while (true)
                {
                    switch (NextToken)
                    {
                        case Token.None:
                            throw new InvalidOperationException("Unexpected end while parsing object.");
                        case Token.Comma:
                            _json.Read();
                            continue;
                        case Token.CurlyClose:
                            _json.Read();
                            return table;
                        default:
                            var name = ParseString();
                            if (NextToken != Token.Colon)
                            {
                                throw new InvalidOperationException("Expected ':' after object key.");
                            }

                            _json.Read();
                            table[name] = ParseValue();
                            break;
                    }
                }
            }

            private List<object> ParseArray()
            {
                var array = new List<object>();

                _json.Read();

                var parsing = true;
                while (parsing)
                {
                    var token = NextToken;
                    switch (token)
                    {
                        case Token.None:
                            throw new InvalidOperationException("Unexpected end while parsing array.");
                        case Token.Comma:
                            _json.Read();
                            continue;
                        case Token.SquaredClose:
                            _json.Read();
                            parsing = false;
                            break;
                        default:
                            var value = ParseByToken(token);
                            array.Add(value);
                            break;
                    }
                }

                return array;
            }

            private object ParseValue()
            {
                var token = NextToken;
                return ParseByToken(token);
            }

            private object ParseByToken(Token token)
            {
                switch (token)
                {
                    case Token.String:
                        return ParseString();
                    case Token.Number:
                        return ParseNumber();
                    case Token.CurlyOpen:
                        return ParseObject();
                    case Token.SquaredOpen:
                        return ParseArray();
                    case Token.True:
                        return true;
                    case Token.False:
                        return false;
                    case Token.Null:
                        return null;
                    default:
                        throw new InvalidOperationException("Unexpected token while parsing value.");
                }
            }

            private string ParseString()
            {
                var builder = new StringBuilder();
                char c;

                _json.Read();

                var parsing = true;
                while (parsing)
                {
                    if (_json.Peek() == -1)
                    {
                        break;
                    }

                    c = NextChar;
                    switch (c)
                    {
                        case '"':
                            parsing = false;
                            break;
                        case '\\':
                            if (_json.Peek() == -1)
                            {
                                parsing = false;
                                break;
                            }

                            c = NextChar;
                            switch (c)
                            {
                                case '"':
                                case '\\':
                                case '/':
                                    builder.Append(c);
                                    break;
                                case 'b':
                                    builder.Append('\b');
                                    break;
                                case 'f':
                                    builder.Append('\f');
                                    break;
                                case 'n':
                                    builder.Append('\n');
                                    break;
                                case 'r':
                                    builder.Append('\r');
                                    break;
                                case 't':
                                    builder.Append('\t');
                                    break;
                                case 'u':
                                    var hex = new char[4];
                                    for (var i = 0; i < 4; i += 1)
                                    {
                                        hex[i] = NextChar;
                                    }

                                    builder.Append((char)Convert.ToInt32(new string(hex), 16));
                                    break;
                            }

                            break;
                        default:
                            builder.Append(c);
                            break;
                    }
                }

                return builder.ToString();
            }

            private object ParseNumber()
            {
                var number = NextWord;
                if (number.IndexOf('.') == -1 &&
                    number.IndexOf('e') == -1 &&
                    number.IndexOf('E') == -1)
                {
                    if (long.TryParse(number, NumberStyles.Integer, CultureInfo.InvariantCulture, out var parsedInt))
                    {
                        return parsedInt;
                    }
                }

                if (double.TryParse(number, NumberStyles.Float, CultureInfo.InvariantCulture, out var parsedDouble))
                {
                    return parsedDouble;
                }

                throw new InvalidOperationException("Invalid numeric token: " + number);
            }

            private void EatWhitespace()
            {
                while (char.IsWhiteSpace(PeekChar))
                {
                    _json.Read();
                    if (_json.Peek() == -1)
                    {
                        break;
                    }
                }
            }

            private char PeekChar
            {
                get
                {
                    var peek = _json.Peek();
                    return peek == -1 ? '\0' : Convert.ToChar(peek);
                }
            }

            private char NextChar
            {
                get
                {
                    var next = _json.Read();
                    return next == -1 ? '\0' : Convert.ToChar(next);
                }
            }

            private string NextWord
            {
                get
                {
                    var builder = new StringBuilder();

                    while (!IsWordBreak(PeekChar))
                    {
                        builder.Append(NextChar);
                        if (_json.Peek() == -1)
                        {
                            break;
                        }
                    }

                    return builder.ToString();
                }
            }

            private Token NextToken
            {
                get
                {
                    EatWhitespace();

                    if (_json.Peek() == -1)
                    {
                        return Token.None;
                    }

                    switch (PeekChar)
                    {
                        case '{':
                            return Token.CurlyOpen;
                        case '}':
                            return Token.CurlyClose;
                        case '[':
                            return Token.SquaredOpen;
                        case ']':
                            return Token.SquaredClose;
                        case ',':
                            return Token.Comma;
                        case '"':
                            return Token.String;
                        case ':':
                            return Token.Colon;
                        case '0':
                        case '1':
                        case '2':
                        case '3':
                        case '4':
                        case '5':
                        case '6':
                        case '7':
                        case '8':
                        case '9':
                        case '-':
                            return Token.Number;
                    }

                    switch (NextWord)
                    {
                        case "false":
                            return Token.False;
                        case "true":
                            return Token.True;
                        case "null":
                            return Token.Null;
                    }

                    return Token.None;
                }
            }

            private static bool IsWordBreak(char c)
            {
                return char.IsWhiteSpace(c) || WORD_BREAK.IndexOf(c) != -1;
            }
        }

        private sealed class Serializer
        {
            private readonly StringBuilder _builder;

            private Serializer()
            {
                _builder = new StringBuilder();
            }

            public static string Serialize(object obj)
            {
                var instance = new Serializer();
                instance.SerializeValue(obj);
                return instance._builder.ToString();
            }

            private void SerializeValue(object value)
            {
                if (value == null)
                {
                    _builder.Append("null");
                }
                else if (value is string stringValue)
                {
                    SerializeString(stringValue);
                }
                else if (value is bool boolValue)
                {
                    _builder.Append(boolValue ? "true" : "false");
                }
                else if (value is IDictionary dictionary)
                {
                    SerializeObject(dictionary);
                }
                else if (value is IList list)
                {
                    SerializeArray(list);
                }
                else if (value is char charValue)
                {
                    SerializeString(new string(charValue, 1));
                }
                else if (value is float ||
                         value is double ||
                         value is decimal ||
                         value is sbyte ||
                         value is byte ||
                         value is short ||
                         value is ushort ||
                         value is int ||
                         value is uint ||
                         value is long ||
                         value is ulong)
                {
                    SerializeNumber(value);
                }
                else
                {
                    SerializeString(value.ToString());
                }
            }

            private void SerializeObject(IDictionary obj)
            {
                var first = true;
                _builder.Append('{');

                foreach (var key in obj.Keys)
                {
                    if (!first)
                    {
                        _builder.Append(',');
                    }

                    SerializeString(Convert.ToString(key, CultureInfo.InvariantCulture));
                    _builder.Append(':');
                    SerializeValue(obj[key]);
                    first = false;
                }

                _builder.Append('}');
            }

            private void SerializeArray(IList array)
            {
                _builder.Append('[');
                var first = true;
                foreach (var item in array)
                {
                    if (!first)
                    {
                        _builder.Append(',');
                    }

                    SerializeValue(item);
                    first = false;
                }

                _builder.Append(']');
            }

            private void SerializeString(string str)
            {
                _builder.Append('"');

                var charArray = str.ToCharArray();
                foreach (var c in charArray)
                {
                    switch (c)
                    {
                        case '"':
                            _builder.Append("\\\"");
                            break;
                        case '\\':
                            _builder.Append("\\\\");
                            break;
                        case '\b':
                            _builder.Append("\\b");
                            break;
                        case '\f':
                            _builder.Append("\\f");
                            break;
                        case '\n':
                            _builder.Append("\\n");
                            break;
                        case '\r':
                            _builder.Append("\\r");
                            break;
                        case '\t':
                            _builder.Append("\\t");
                            break;
                        default:
                            var codepoint = Convert.ToInt32(c);
                            if (codepoint >= 32 && codepoint <= 126)
                            {
                                _builder.Append(c);
                            }
                            else
                            {
                                _builder.Append("\\u");
                                _builder.Append(codepoint.ToString("x4"));
                            }

                            break;
                    }
                }

                _builder.Append('"');
            }

            private void SerializeNumber(object number)
            {
                _builder.Append(Convert.ToString(number, CultureInfo.InvariantCulture));
            }
        }
    }
}
