using UnityEngine;
using UnityEngine.UI;

public class ColorButtonHandler : MonoBehaviour
{
    private Button _button;

    private void Awake()
    {
        _button = GetComponent<Button>();
        if (_button == null)
        {
            Debug.LogError("ColorButtonHandler requires a Button component.");
            return;
        }

        // 根据按钮名称绑定不同的点击事件
        string buttonName = gameObject.name;
        if (buttonName.Contains("Red"))
        {
            _button.onClick.RemoveListener(OnRedButtonClick);
            _button.onClick.AddListener(OnRedButtonClick);
        }
        else if (buttonName.Contains("Yellow"))
        {
            _button.onClick.RemoveListener(OnYellowButtonClick);
            _button.onClick.AddListener(OnYellowButtonClick);
        }
        else if (buttonName.Contains("Blue"))
        {
            _button.onClick.RemoveListener(OnBlueButtonClick);
            _button.onClick.AddListener(OnBlueButtonClick);
        }
    }

    private void OnDestroy()
    {
        if (_button != null)
        {
            _button.onClick.RemoveListener(OnRedButtonClick);
            _button.onClick.RemoveListener(OnYellowButtonClick);
            _button.onClick.RemoveListener(OnBlueButtonClick);
        }
    }

    public void OnRedButtonClick()
    {
        Debug.Log("红色按钮被点击");
    }
    
    public void OnYellowButtonClick()
    {
        Debug.Log("黄色按钮被点击");
    }
    
    public void OnBlueButtonClick()
    {
        Debug.Log("蓝色按钮被点击");
    }
}